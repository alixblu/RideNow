package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cloudnative.microservices.notification.dto.IncomingEvent;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import tools.jackson.databind.ObjectMapper;

class TrackingPairingServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> ops = mock(ValueOperations.class);
    private TrackingPairingService service;

    private final UUID tripId = UUID.randomUUID();
    private final UUID passengerId = UUID.randomUUID();
    private final UUID driverId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(ops);
        service = new TrackingPairingService(redis, mapper);
    }

    private IncomingEvent event(String type, Map<String, String> data) {
        return new IncomingEvent(UUID.randomUUID(), type, tripId, null, data);
    }

    private Map<String, String> full() {
        return Map.of("tripId", tripId.toString(), "passengerId", passengerId.toString(),
                "driverId", driverId.toString());
    }

    @Test
    void driverAcceptedSetsBothKeysWithA3hTtl() {
        service.apply(event("driver.accepted", full()));

        verify(ops).set("ridenow:tracking:trip:" + tripId,
                "{\"passengerId\":\"" + passengerId + "\",\"driverId\":\"" + driverId + "\"}",
                Duration.ofHours(3));
        verify(ops).set("ridenow:tracking:driver:" + driverId,
                "{\"tripId\":\"" + tripId + "\",\"passengerId\":\"" + passengerId + "\"}",
                Duration.ofHours(3));
    }

    @Test
    void driverAcceptedWithAMissingIdSetsNothing() {
        Map<String, String> data = new HashMap<>(full());
        data.remove("driverId");

        service.apply(event("driver.accepted", data));

        verifyNoInteractions(ops);
    }

    @Test
    void tripCompletedDeletesBothKeysAndPublishesEnded() {
        when(ops.get("ridenow:tracking:driver:" + driverId))
                .thenReturn("{\"tripId\":\"" + tripId + "\",\"passengerId\":\"" + passengerId + "\"}");

        service.apply(event("trip.completed", full()));

        verify(redis).delete("ridenow:tracking:trip:" + tripId);
        verify(redis).delete("ridenow:tracking:driver:" + driverId);
        verify(redis).convertAndSend("ridenow:tracking:ended", "{\"tripId\":\"" + tripId + "\"}");
    }

    @Test
    void aCancelWithNoDriverStillEndsTheTrip() {
        // Cancelled while still SEARCHING: no driver id, no driver key to find.
        service.apply(event("trip.cancelled",
                Map.of("tripId", tripId.toString(), "passengerId", passengerId.toString())));

        verify(redis).delete("ridenow:tracking:trip:" + tripId);
        verify(redis, never()).delete("ridenow:tracking:driver:" + driverId);
        verify(redis).convertAndSend("ridenow:tracking:ended", "{\"tripId\":\"" + tripId + "\"}");
    }

    @Test
    void theCompensationEventWithNoPassengerIdIsHarmless() {
        service.apply(event("trip.cancelled", Map.of("tripId", tripId.toString(),
                "cancellationReason", "payment unavailable", "compensation", "true")));

        verify(redis).delete("ridenow:tracking:trip:" + tripId);
        verify(redis).convertAndSend("ridenow:tracking:ended", "{\"tripId\":\"" + tripId + "\"}");
    }

    @Test
    void theDriverComesFromTheTripKeyWhenTheEventLacksIt() {
        when(ops.get("ridenow:tracking:trip:" + tripId))
                .thenReturn("{\"passengerId\":\"" + passengerId + "\",\"driverId\":\"" + driverId + "\"}");
        when(ops.get("ridenow:tracking:driver:" + driverId))
                .thenReturn("{\"tripId\":\"" + tripId + "\",\"passengerId\":\"" + passengerId + "\"}");

        service.apply(event("trip.cancelled", Map.of("tripId", tripId.toString())));

        verify(redis).delete("ridenow:tracking:driver:" + driverId);
    }

    @Test
    void aLateEndEventDoesNotRemoveTheDriversNewerPairing() {
        UUID newerTrip = UUID.randomUUID();
        when(ops.get("ridenow:tracking:driver:" + driverId))
                .thenReturn("{\"tripId\":\"" + newerTrip + "\",\"passengerId\":\"" + passengerId + "\"}");

        service.apply(event("trip.completed", full()));

        verify(redis).delete("ridenow:tracking:trip:" + tripId);
        verify(redis, never()).delete("ridenow:tracking:driver:" + driverId);
    }

    @Test
    void otherEventsDoNothing() {
        service.apply(event("trip.started", full()));
        service.apply(event("payment.succeeded", full()));

        verifyNoInteractions(ops);
        verify(redis, never()).delete(anyString());
        verify(redis, never()).convertAndSend(anyString(), anyString());
    }

    @Test
    void aRedisFailureIsRethrownSoTheMessageIsRetried() {
        doThrow(new IllegalStateException("redis down")).when(redis).delete(anyString());

        assertThatThrownBy(() -> service.apply(event("trip.completed", full())))
                .isInstanceOf(IllegalStateException.class);
        assertThat(true).isTrue();
    }
}
