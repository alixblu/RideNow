package cloudnative.microservices.trip.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Browser origins allowed to call this service's {@code /api/**} endpoints.
 *
 * @param allowedOrigins origin patterns ("*" = any; local only). Set with
 *                       {@code RIDENOW_CORS_ALLOWED_ORIGINS} (comma separated).
 */
@ConfigurationProperties(prefix = "ridenow.cors")
public record CorsProperties(
        @DefaultValue("*") List<String> allowedOrigins
) {
}
