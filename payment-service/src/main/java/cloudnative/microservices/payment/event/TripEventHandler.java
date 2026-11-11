package cloudnative.microservices.payment.event;

import cloudnative.microservices.payment.exception.ResourceNotFoundException;
import cloudnative.microservices.payment.service.PaymentService;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Turns a trip event into a payment action:
 * <ul>
 *   <li>{@code trip.completed} -> capture the final fare against the hold;</li>
 *   <li>{@code trip.cancelled} -> release the hold.</li>
 * </ul>
 * Anything else is ignored.
 *
 * Retry contract with the SQS consumer: returning normally means "done, delete the
 * message"; throwing means "retry" (and eventually dead-letter). So events that
 * can never succeed (malformed, or no payment for that trip) are logged and
 * dropped instead of retried five times for nothing. Capture and release are
 * idempotent in {@link PaymentService}, so a duplicate delivery changes nothing.
 */
@Component
@RequiredArgsConstructor
public class TripEventHandler {

    private static final Logger log = LoggerFactory.getLogger(TripEventHandler.class);

    static final String TRIP_COMPLETED = "trip.completed";
    static final String TRIP_CANCELLED = "trip.cancelled";

    private final PaymentService paymentService;

    public void handle(IncomingEvent event) {
        if (event == null || event.type() == null) {
            log.warn("Dropping event with no type: {}", event);
            return;
        }
        if (!TRIP_COMPLETED.equals(event.type()) && !TRIP_CANCELLED.equals(event.type())) {
            log.debug("Ignoring event type {}", event.type());
            return;
        }

        Map<String, String> data = event.data() != null ? event.data() : Map.of();
        UUID tripId;
        try {
            tripId = UUID.fromString(data.get("tripId"));
        } catch (RuntimeException ex) { // null or malformed
            log.warn("Dropping {} event {} with missing/invalid tripId", event.type(), event.eventId());
            return;
        }

        try {
            if (TRIP_COMPLETED.equals(event.type())) {
                paymentService.capture(tripId, parseAmount(data.get("finalFare")), parseUuid(data.get("passengerId")));
            } else {
                paymentService.release(tripId);
            }
        } catch (ResourceNotFoundException ex) {
            // Authorize is synchronous and precedes the trip, so a payment normally
            // exists. None means: a compensation event for a trip that never got a
            // hold, or data we cannot fix by retrying. Drop it.
            log.info("No payment for trip {} on {}; nothing to do", tripId, event.type());
        } catch (NumberFormatException ex) {
            log.warn("Dropping {} event {} with an invalid finalFare", event.type(), event.eventId());
        }
    }

    private static BigDecimal parseAmount(String value) {
        return value == null || value.isBlank() ? null : new BigDecimal(value);
    }

    private static UUID parseUuid(String value) {
        try {
            return value == null ? null : UUID.fromString(value);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }
}
