package cloudnative.microservices.notification.tracing;

import io.opentelemetry.api.GlobalOpenTelemetry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Tracing beans built on the OpenTelemetry API. No-ops unless the OTel Java agent is attached. */
@Configuration
public class TracingConfig {

    @Bean
    public MessagingTracer messagingTracer() {
        return new MessagingTracer(GlobalOpenTelemetry.get(),
                new TraceContextCarrier(GlobalOpenTelemetry.getPropagators().getTextMapPropagator()));
    }
}
