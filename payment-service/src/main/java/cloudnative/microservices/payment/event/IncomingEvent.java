package cloudnative.microservices.payment.event;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;
import java.util.UUID;

/**
 * A trip-service domain event as payment-service reads it, projected from the
 * "detail" object of the EventBridge-to-SQS message. Only the fields needed here
 * are mapped; unknown fields are ignored so trip-service's contract can grow
 * without breaking this consumer (and there is no shared cross-service module).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record IncomingEvent(
        UUID eventId,
        String type,
        UUID aggregateId,
        Map<String, String> data
) {
}
