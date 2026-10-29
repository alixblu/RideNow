package cloudnative.microservices.notification.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;
import java.util.UUID;

/**
 * The domain event as this worker reads it, projected from the "detail" object
 * of the EventBridge-to-SQS message. Only the fields the worker needs are mapped;
 * unknown fields are ignored so the producer's contract can grow without breaking
 * the consumer.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record IncomingEvent(
        UUID eventId,
        String type,
        UUID aggregateId,
        Map<String, String> data
) {
}
