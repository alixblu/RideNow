package cloudnative.microservices.trip.event;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the default {@link LoggingDomainEventPublisher} ONLY when no other
 * {@link DomainEventPublisher} bean is present. Under the "eventbridge" profile
 * the {@link EventBridgeDomainEventPublisher} component is present, so this
 * fallback is skipped - exactly one publisher bean exists in either mode.
 */
@Configuration
public class EventPublisherConfig {

    @Bean
    @ConditionalOnMissingBean(DomainEventPublisher.class)
    DomainEventPublisher loggingDomainEventPublisher() {
        return new LoggingDomainEventPublisher();
    }
}
