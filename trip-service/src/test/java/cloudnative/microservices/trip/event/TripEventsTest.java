package cloudnative.microservices.trip.event;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.Trip;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Pins the JSON contract of the trip events that other services consume. */
class TripEventsTest {

    private Trip searching() {
        return new Trip(UUID.randomUUID(), UUID.randomUUID(), RideType.CAR,
                new BigDecimal("10.762622"), new BigDecimal("106.660172"),
                new BigDecimal("10.776889"), new BigDecimal("106.700806"),
                new BigDecimal("45000.00"), Instant.now());
    }

    @Test
    void tripRequestedCarriesPickupDestinationAndEstimate() {
        Trip trip = searching();

        DomainEvent event = TripEvents.tripRequested(trip);

        assertThat(event.type()).isEqualTo("trip.requested");
        assertThat(event.aggregateId()).isEqualTo(trip.getId());
        assertThat(event.data())
                .containsEntry("tripId", trip.getId().toString())
                .containsEntry("passengerId", trip.getPassengerId().toString())
                .containsEntry("status", "SEARCHING")
                .containsEntry("rideType", "CAR")
                .containsEntry("pickupLat", "10.762622")
                .containsEntry("pickupLng", "106.660172")
                .containsEntry("destinationLat", "10.776889")
                .containsEntry("destinationLng", "106.700806")
                .containsEntry("estimatedFare", "45000.00")
                .doesNotContainKeys("driverId", "finalFare");
    }

    @Test
    void tripCompletedCarriesDriverAndFinalFare() {
        Trip trip = searching();
        UUID driverId = UUID.randomUUID();
        trip.acceptBy(driverId, Instant.now());
        trip.arrive(Instant.now());
        trip.start(Instant.now());
        trip.complete(Instant.now());

        DomainEvent event = TripEvents.tripCompleted(trip);

        assertThat(event.type()).isEqualTo("trip.completed");
        assertThat(event.data())
                .containsEntry("driverId", driverId.toString())
                .containsEntry("status", "COMPLETED")
                .containsEntry("finalFare", "45000.00");
    }

    @Test
    void tripStartedAndCancelledHaveTheirTypes() {
        Trip trip = searching();
        trip.acceptBy(UUID.randomUUID(), Instant.now());
        trip.arrive(Instant.now());
        trip.start(Instant.now());
        assertThat(TripEvents.tripStarted(trip).type()).isEqualTo("trip.started");

        Trip other = searching();
        other.cancel("Cancelled by rider", Instant.now());
        DomainEvent cancelled = TripEvents.tripCancelled(other);
        assertThat(cancelled.type()).isEqualTo("trip.cancelled");
        assertThat(cancelled.data()).containsEntry("cancellationReason", "Cancelled by rider");
    }

    @Test
    void tripCreationFailedReleasesTheHoldButNamesNoRecipient() {
        UUID tripId = UUID.randomUUID();

        DomainEvent event = TripEvents.tripCreationFailed(tripId, "db down");

        assertThat(event.type()).isEqualTo("trip.cancelled");
        assertThat(event.aggregateId()).isEqualTo(tripId);
        assertThat(event.data())
                .containsEntry("tripId", tripId.toString())
                .containsEntry("cancellationReason", "db down")
                .containsEntry("compensation", "true")
                // No passengerId/driverId: notification-worker must send nothing.
                .doesNotContainKeys("passengerId", "driverId");
    }
}
