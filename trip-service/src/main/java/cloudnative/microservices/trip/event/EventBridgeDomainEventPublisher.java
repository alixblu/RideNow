package cloudnative.microservices.trip.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequest;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequestEntry;
import software.amazon.awssdk.services.eventbridge.model.PutEventsResponse;

/**
 * Publishes {@link DomainEvent}s to an Amazon EventBridge bus via the AWS SDK v2.
 *
 * Active only under the "eventbridge" profile; it then replaces the logging
 * publisher as the {@link DomainEventPublisher} bean (a pure substitution behind
 * the interface). Each event becomes one PutEvents entry:
 *   Source     = ridenow.trip
 *   DetailType = the event type (e.g. trip.completed) - what the rule can match
 *   Detail     = the event serialized as JSON
 *   EventBusName = the configured RideNow bus
 */
@Component
@Profile("eventbridge")
public class EventBridgeDomainEventPublisher implements DomainEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(EventBridgeDomainEventPublisher.class);

    private final EventBridgeClient client;
    private final ObjectMapper objectMapper;
    private final String busName;

    public EventBridgeDomainEventPublisher(
            EventBridgeClient client,
            ObjectMapper objectMapper,
            @Value("${RIDENOW_EVENTS_BUS_NAME:ridenow-local-events}") String busName
    ) {
        this.client = client;
        this.objectMapper = objectMapper;
        this.busName = busName;
    }

    @Override
    public void publish(DomainEvent event) {
        String detail = objectMapper.writeValueAsString(event);
        PutEventsRequestEntry entry = PutEventsRequestEntry.builder()
                .eventBusName(busName)
                .source(DomainEvent.SOURCE)
                .detailType(event.type())
                .detail(detail)
                .build();

        PutEventsResponse response = client.putEvents(PutEventsRequest.builder()
                .entries(entry)
                .build());

        if (response.failedEntryCount() != null && response.failedEntryCount() > 0) {
            // Log and move on: a publish failure must not break the committed
            // business transaction (we are already past commit).
            log.error("EventBridge rejected event type={} eventId={}: {}",
                    event.type(), event.eventId(),
                    response.entries().isEmpty() ? "unknown" : response.entries().get(0).errorMessage());
        } else {
            log.info("Published event type={} eventId={} to bus={}",
                    event.type(), event.eventId(), busName);
        }
    }
}
