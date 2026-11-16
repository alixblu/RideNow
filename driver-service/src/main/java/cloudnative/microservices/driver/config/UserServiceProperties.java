package cloudnative.microservices.driver.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where and how to reach user-service. Configurable so it works on laptop, Docker,
 * and k8s. Short timeouts on purpose: a hung user-service must fail the request
 * quickly instead of tying up driver-service threads.
 */
@ConfigurationProperties(prefix = "services.user-service")
public record UserServiceProperties(String baseUrl, Duration connectTimeout, Duration readTimeout) {
}
