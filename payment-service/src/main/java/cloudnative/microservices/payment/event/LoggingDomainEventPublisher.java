package cloudnative.microservices.payment.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Default publisher: logs the event instead of sending it, so payment-service
 * runs with no AWS. A plain class; {@link EventPublisherConfig} registers it only
 * when no other {@link DomainEventPublisher} bean exists, so the EventBridge
 * publisher cleanly replaces it under the "eventbridge" profile.
 */
public class LoggingDomainEventPublisher implements DomainEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(LoggingDomainEventPublisher.class);

    @Override
    public void publish(DomainEvent event) {
        log.info("[event] source={} type={} version={} eventId={} aggregateId={} data={}",
                DomainEvent.SOURCE, event.type(), event.version(), event.eventId(),
                event.aggregateId(), event.data());
    }
}
