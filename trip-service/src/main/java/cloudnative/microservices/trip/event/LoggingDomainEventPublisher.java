package cloudnative.microservices.trip.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Default publisher: logs the event payload instead of sending it anywhere. This
 * lets trip-service run with no AWS at all (plain {@code mvn test}, local runs
 * without the "eventbridge" profile). It is a plain class (not a Spring
 * component); {@link EventPublisherConfig} registers it only when no other
 * {@link DomainEventPublisher} bean exists, so the EventBridge publisher cleanly
 * replaces it under the "eventbridge" profile.
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
