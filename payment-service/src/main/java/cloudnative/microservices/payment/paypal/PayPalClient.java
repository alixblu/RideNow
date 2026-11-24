package cloudnative.microservices.payment.paypal;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * Thin HTTP client for the PayPal REST API (Orders v2 and Payments v2). Handles the
 * OAuth2 client-credentials token (cached until shortly before expiry) and the
 * PayPal-Request-Id idempotency header. Contains no business rules.
 */
@Component
public class PayPalClient {

    private static final Logger log = LoggerFactory.getLogger(PayPalClient.class);
    private static final ParameterizedTypeReference<Map<String, Object>> MAP = new ParameterizedTypeReference<>() { };

    private final PayPalProperties props;
    private final RestClient rest;
    private String token;
    private Instant tokenExpiry = Instant.EPOCH;

    public PayPalClient(PayPalProperties props) {
        this.props = props;
        org.springframework.http.client.JdkClientHttpRequestFactory factory =
                new org.springframework.http.client.JdkClientHttpRequestFactory();
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.rest = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory).build();
    }

    public PayPalProperties properties() {
        return props;
    }

    /**
     * POSTs JSON to a PayPal path and returns the response body.
     *
     * @param requestId PayPal-Request-Id; PayPal replays the original result for a repeated id
     * @throws PayPalException not configured, PayPal rejected the call (message carries the HTTP status), or unreachable
     */
    public Map<String, Object> post(String path, String requestId, Object body) {
        if (!props.configured()) {
            throw new PayPalException("PayPal is not configured");
        }
        try {
            Map<String, Object> response = rest.post()
                    .uri(path)
                    .headers(h -> {
                        h.setBearerAuth(accessToken());
                        if (requestId != null) {
                            h.set("PayPal-Request-Id", requestId);
                        }
                        h.set("Prefer", "return=representation");
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body == null ? Map.of() : body)
                    .retrieve()
                    .body(MAP);
            return response == null ? Map.of() : response;
        } catch (RestClientResponseException e) {
            log.warn("PayPal {} failed: HTTP {} {}", path, e.getStatusCode().value(), e.getResponseBodyAsString());
            throw new PayPalException("PayPal rejected the request (HTTP " + e.getStatusCode().value() + ")", e);
        } catch (RuntimeException e) {
            if (e instanceof PayPalException pe) {
                throw pe;
            }
            log.warn("PayPal {} unreachable: {}", path, e.getMessage());
            throw new PayPalException("PayPal is unavailable", e);
        }
    }

    private synchronized String accessToken() {
        if (token != null && Instant.now().isBefore(tokenExpiry.minusSeconds(60))) {
            return token;
        }
        try {
            Map<String, Object> response = rest.post()
                    .uri("/v1/oauth2/token")
                    .headers(h -> h.setBasicAuth(props.clientId(), props.clientSecret()))
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body("grant_type=client_credentials")
                    .retrieve()
                    .body(MAP);
            if (response == null || !(response.get("access_token") instanceof String t)) {
                throw new PayPalException("PayPal returned no access token");
            }
            long seconds = response.get("expires_in") instanceof Number n ? n.longValue() : 300;
            token = t;
            tokenExpiry = Instant.now().plusSeconds(seconds);
            return token;
        } catch (RestClientResponseException e) {
            throw new PayPalException("PayPal credentials were rejected (HTTP " + e.getStatusCode().value() + ")", e);
        }
    }
}
