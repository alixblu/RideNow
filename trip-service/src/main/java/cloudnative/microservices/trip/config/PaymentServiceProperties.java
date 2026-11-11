package cloudnative.microservices.trip.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where and how to reach payment-service. Short timeouts on purpose: this call is
 * synchronous on the trip-request path, so a hung payment-service must fail the
 * request quickly instead of tying up threads.
 */
@ConfigurationProperties(prefix = "services.payment-service")
public record PaymentServiceProperties(String baseUrl, Duration connectTimeout, Duration readTimeout) {
}
