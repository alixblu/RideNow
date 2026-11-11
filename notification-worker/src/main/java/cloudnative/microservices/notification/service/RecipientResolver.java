package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.IncomingEvent;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Decides who should hear about an event, using only the ids the event carries
 * (the worker owns no user data and calls no other service):
 * <ul>
 *   <li>{@code match.offered}  -> the offered driver;</li>
 *   <li>{@code trip.cancelled} -> the passenger, and the driver if one was assigned;</li>
 *   <li>everything else (trip lifecycle, payment) -> the passenger.</li>
 * </ul>
 * An id that is missing or not a UUID is skipped, so a malformed event yields no
 * recipients rather than an error.
 */
@Component
public class RecipientResolver {

    public List<UUID> recipients(IncomingEvent event) {
        Map<String, String> data = event.data() != null ? event.data() : Map.of();
        Set<UUID> recipients = new LinkedHashSet<>();
        switch (event.type()) {
            case "match.offered" -> add(recipients, data.get("driverId"));
            case "trip.cancelled" -> {
                add(recipients, data.get("passengerId"));
                add(recipients, data.get("driverId"));
            }
            default -> add(recipients, data.get("passengerId"));
        }
        return List.copyOf(recipients);
    }

    private static void add(Set<UUID> recipients, String id) {
        if (id == null) {
            return;
        }
        try {
            recipients.add(UUID.fromString(id));
        } catch (IllegalArgumentException ignored) {
            // not a UUID: skip it
        }
    }
}
