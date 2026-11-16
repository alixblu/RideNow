package cloudnative.microservices.driver.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Pins the JSON that realtime-gateway and matching-service read from the location channel. */
class LocationPublisherTest {

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final LocationPublisher publisher = new LocationPublisher(redis, mapper);
    private final UUID driverId = UUID.randomUUID();

    private JsonNode published() {
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(redis).convertAndSend(eq(LocationPublisher.CHANNEL), body.capture());
        return mapper.readTree(body.getValue());
    }

    @Test
    void aPositionCarriesIdCoordinatesRecordedAtAndOnline() {
        publisher.publish(driverId, new BigDecimal("10.7769"), new BigDecimal("106.7009"),
                Instant.parse("2026-11-11T07:00:00Z"), cloudnative.microservices.driver.entity.VehicleType.CAR);

        JsonNode json = published();
        assertThat(json.path("driverId").asString()).isEqualTo(driverId.toString());
        assertThat(json.path("lat").decimalValue()).isEqualByComparingTo("10.7769");
        assertThat(json.path("lng").decimalValue()).isEqualByComparingTo("106.7009");
        assertThat(json.path("lat").isNumber()).isTrue();
        assertThat(json.path("recordedAt").asString()).isEqualTo("2026-11-11T07:00:00Z");
        assertThat(json.path("vehicleType").asString()).isEqualTo("CAR");
        assertThat(json.path("online").asBoolean()).isTrue();
    }

    @Test
    void goingOfflinePublishesAMarkerWithNoPosition() {
        publisher.publishOffline(driverId, Instant.parse("2026-11-11T07:05:00Z"));

        JsonNode json = published();
        assertThat(json.path("driverId").asString()).isEqualTo(driverId.toString());
        assertThat(json.path("online").asBoolean()).isFalse();
        assertThat(json.path("lat").isNull() || json.path("lat").isMissingNode()).isTrue();
        assertThat(json.path("recordedAt").asString()).isEqualTo("2026-11-11T07:05:00Z");
    }
}
