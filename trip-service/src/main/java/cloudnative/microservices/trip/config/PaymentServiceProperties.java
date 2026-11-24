package cloudnative.microservices.trip.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Where and how to reach payment-service. Short timeouts on purpose: this call is
 * synchronous on the trip-request path, so a hung payment-service must fail the
 * request quickly instead of tying up threads.
 *
 * <p>{@code maxAttempts} and {@code retryBackoff} cover a slow first request (a
 * payment pod that has just started can take longer than {@code readTimeout} on its
 * first authorize). The authorize call is idempotent on the trip id, so retrying it
 * cannot place a second hold.
 */
@ConfigurationProperties(prefix = "services.payment-service")
public record PaymentServiceProperties(
        String baseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        @DefaultValue("3") int maxAttempts,
        @DefaultValue("500ms") Duration retryBackoff) {
}
