package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.notification.dto.IncomingEvent;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class RecipientResolverTest {

    private final RecipientResolver resolver = new RecipientResolver();

    private final UUID passenger = UUID.randomUUID();
    private final UUID driver = UUID.randomUUID();

    private IncomingEvent event(String type, Map<String, String> data) {
        return new IncomingEvent(UUID.randomUUID(), type, UUID.randomUUID(), "2026-11-11T07:00:00Z", data);
    }

    private Map<String, String> both() {
        Map<String, String> data = new HashMap<>();
        data.put("passengerId", passenger.toString());
        data.put("driverId", driver.toString());
        return data;
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "trip.requested", "driver.accepted", "driver.arrived", "trip.started",
            "trip.completed", "payment.succeeded", "payment.failed", "something.new"})
    void passengerFacingEventsGoToThePassengerOnly(String type) {
        assertThat(resolver.recipients(event(type, both()))).containsExactly(passenger);
    }

    @Test
    void matchOfferedGoesToTheOfferedDriverOnly() {
        assertThat(resolver.recipients(event("match.offered", both()))).containsExactly(driver);
    }

    @Test
    void cancellationGoesToThePassengerAndTheAssignedDriver() {
        assertThat(resolver.recipients(event("trip.cancelled", both()))).containsExactly(passenger, driver);
    }

    @Test
    void cancellationBeforeAnyDriverWasAssignedGoesToThePassengerOnly() {
        Map<String, String> data = both();
        data.remove("driverId");

        assertThat(resolver.recipients(event("trip.cancelled", data))).containsExactly(passenger);
    }

    @Test
    void missingOrInvalidIdsYieldNoRecipients() {
        assertThat(resolver.recipients(event("driver.accepted", Map.of()))).isEmpty();
        assertThat(resolver.recipients(event("driver.accepted", null))).isEmpty();
        assertThat(resolver.recipients(event("match.offered", Map.of("driverId", "not-a-uuid")))).isEmpty();
    }
}
