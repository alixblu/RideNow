package cloudnative.microservices.trip.client;

import cloudnative.microservices.trip.config.PaymentServiceProperties;
import cloudnative.microservices.trip.dto.request.PaymentMethod;
import cloudnative.microservices.trip.exception.PaymentDeclinedException;
import cloudnative.microservices.trip.exception.PaymentUnavailableException;
import java.math.BigDecimal;
import java.time.Duration;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Talks to payment-service over HTTP. The one synchronous cross-service call on
 * the trip-request path: the rider must know the card works before a driver is
 * bothered. trip-service does not own payment data.
 *
 * <p>The authorize call is retried when it times out or cannot connect, because a
 * payment pod that has just started can be slower than the read timeout on its first
 * request. Retrying is safe: the trip id is the idempotency key, so payment-service
 * returns the existing payment instead of placing a second hold. A retry that arrives
 * while the first attempt is still being processed gets 409 (the key is already
 * taken); the client then reads the payment for the trip instead. Server errors and
 * other HTTP errors are not retried.
 */
@Component
public class PaymentServiceClient {

    private static final Logger log = LoggerFactory.getLogger(PaymentServiceClient.class);

    private final RestClient restClient;
    private final int maxAttempts;
    private final Duration retryBackoff;

    @Autowired
    public PaymentServiceClient(RestClient paymentServiceRestClient, PaymentServiceProperties props) {
        this(paymentServiceRestClient, props.maxAttempts(), props.retryBackoff());
    }

    public PaymentServiceClient(RestClient paymentServiceRestClient, int maxAttempts, Duration retryBackoff) {
        this.restClient = paymentServiceRestClient;
        this.maxAttempts = Math.max(1, maxAttempts);
        this.retryBackoff = retryBackoff == null ? Duration.ZERO : retryBackoff;
    }

    /** No retries; for callers that do not need them. */
    public PaymentServiceClient(RestClient paymentServiceRestClient) {
        this(paymentServiceRestClient, 1, Duration.ZERO);
    }

    /**
     * Places a hold for the estimated fare. The trip id doubles as the idempotency
     * key, so a retried request can never create a second hold.
     *
     * @throws PaymentDeclinedException    the authorization was declined
     * @throws PaymentUnavailableException payment-service timed out, was unreachable, or errored
     */
    public void authorize(UUID tripId, UUID passengerId, BigDecimal amount, String currency,
                          PaymentMethod method) {
        AuthorizeRequest body = new AuthorizeRequest(
                tripId, amount, currency, method, tripId.toString(), passengerId);
        AuthorizeResponse response = null;
        for (int attempt = 1; attempt <= maxAttempts && response == null; attempt++) {
            if (attempt > 1) {
                pause();
            }
            try {
                response = restClient.post()
                        .uri("/api/payments")
                        .body(body)
                        .retrieve()
                        .body(AuthorizeResponse.class);
                if (response == null) {
                    throw new PaymentUnavailableException("payment-service returned an empty response");
                }
            } catch (HttpClientErrorException.Conflict e) {
                // The key is taken: an earlier attempt for this trip was stored, or is
                // still being stored. Read it; if it is not visible yet, try again.
                response = existingPayment(tripId);
                if (response == null && attempt == maxAttempts) {
                    log.warn("payment-service authorize for trip {} conflicted and no payment was found", tripId);
                    throw new PaymentUnavailableException("payment-service is unavailable");
                }
            } catch (ResourceAccessException e) {
                // Timeout or connection failure: payment-service may still finish the
                // request, so retrying with the same key is safe.
                log.warn("payment-service authorize attempt {}/{} for trip {} failed: {}",
                        attempt, maxAttempts, tripId, e.getMessage());
                if (attempt == maxAttempts) {
                    throw new PaymentUnavailableException("payment-service is unavailable");
                }
            } catch (RestClientException e) {
                log.warn("payment-service authorize failed for trip {}: {}", tripId, e.getMessage());
                throw new PaymentUnavailableException("payment-service is unavailable");
            }
        }

        if (response.status() == null) {
            throw new PaymentUnavailableException("payment-service returned an empty response");
        }
        if ("FAILED".equals(response.status())) {
            throw new PaymentDeclinedException(
                    response.failureReason() != null ? response.failureReason() : "declined");
        }
    }

    /** The payment already stored for this trip, or null if there is none yet. */
    private AuthorizeResponse existingPayment(UUID tripId) {
        try {
            return restClient.get()
                    .uri(uri -> uri.path("/api/payments").queryParam("tripId", tripId).build())
                    .retrieve()
                    .body(AuthorizeResponse.class);
        } catch (HttpClientErrorException.NotFound e) {
            return null;
        } catch (RestClientException e) {
            log.warn("reading the payment for trip {} failed: {}", tripId, e.getMessage());
            return null;
        }
    }

    private void pause() {
        if (retryBackoff.isZero()) {
            return;
        }
        try {
            Thread.sleep(retryBackoff.toMillis());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PaymentUnavailableException("payment-service is unavailable");
        }
    }

    /** JSON body for payment-service's {@code POST /api/payments}. */
    record AuthorizeRequest(UUID tripId, BigDecimal amount, String currency, PaymentMethod method,
                            String idempotencyKey, UUID passengerId) {
    }

    /** The only fields of payment-service's response that trip-service needs. */
    record AuthorizeResponse(String status, String failureReason) {
    }
}
