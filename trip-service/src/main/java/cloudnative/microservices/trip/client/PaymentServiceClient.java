package cloudnative.microservices.trip.client;

import cloudnative.microservices.trip.dto.request.PaymentMethod;
import cloudnative.microservices.trip.exception.PaymentDeclinedException;
import cloudnative.microservices.trip.exception.PaymentUnavailableException;
import java.math.BigDecimal;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Talks to payment-service over HTTP. The one synchronous cross-service call on
 * the trip-request path: the rider must know the card works before a driver is
 * bothered. trip-service does not own payment data.
 */
@Component
public class PaymentServiceClient {

    private static final Logger log = LoggerFactory.getLogger(PaymentServiceClient.class);

    private final RestClient restClient;

    public PaymentServiceClient(RestClient paymentServiceRestClient) {
        this.restClient = paymentServiceRestClient;
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
        AuthorizeResponse response;
        try {
            response = restClient.post()
                    .uri("/api/payments")
                    .body(body)
                    .retrieve()
                    .body(AuthorizeResponse.class);
        } catch (RestClientException e) {
            log.warn("payment-service authorize failed for trip {}: {}", tripId, e.getMessage());
            throw new PaymentUnavailableException("payment-service is unavailable");
        }

        if (response == null || response.status() == null) {
            throw new PaymentUnavailableException("payment-service returned an empty response");
        }
        if ("FAILED".equals(response.status())) {
            throw new PaymentDeclinedException(
                    response.failureReason() != null ? response.failureReason() : "declined");
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
