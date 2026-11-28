package cloudnative.microservices.realtime.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Lets the browser app (a different origin in development) open the stream with
 * {@code EventSource}, and turns on the heartbeat scheduler.
 */
@Configuration
@EnableScheduling
public class WebConfig implements WebMvcConfigurer {

    private final GatewayProperties properties;

    public WebConfig(GatewayProperties properties) {
        this.properties = properties;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/live/**")
                .allowedMethods("GET")
                .exposedHeaders("X-Trace-Id")
                .allowedOriginPatterns(properties.allowedOrigins().toArray(String[]::new));
    }
}
