package cloudnative.microservices.driver.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Where to reach user-service. Configurable so it works on laptop, Docker, and k8s. */
@ConfigurationProperties(prefix = "services.user-service")
public record UserServiceProperties(String baseUrl) {
}