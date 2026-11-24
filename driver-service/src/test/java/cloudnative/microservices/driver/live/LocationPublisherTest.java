package cloudnative.microservices.driver.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.connection.RedisStreamCommands.XAddOptions;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Pins the JSON that realtime-gateway (channel) and matching-service (stream) read, and
 * that the two writes are independent.
 */
class LocationPublisherTest {

    private static final long MAX_LEN = 10_000;

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final StreamOperations<String, Object, Object> streamOps = mock(StreamOperations.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final LocationPublisher publisher;
    private final UUID driverId = UUID.randomUUID();

    LocationPublisherTest() {
        when(redis.opsForStream()).thenReturn((StreamOperations) streamOps);
        publisher = new LocationPublisher(redis, mapper, MAX_LEN);
    }

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

    @Test
    @SuppressWarnings("unchecked")
    void everyUpdateIsAlsoAppendedToTheCappedStreamWithTheSameJson() {
        publisher.publish(driverId, new BigDecimal("10.7769"), new BigDecimal("106.7009"),
                Instant.parse("2026-11-11T07:00:00Z"), cloudnative.microservices.driver.entity.VehicleType.CAR);

        ArgumentCaptor<MapRecord<String, String, String>> record = ArgumentCaptor.forClass(MapRecord.class);
        ArgumentCaptor<XAddOptions> options = ArgumentCaptor.forClass(XAddOptions.class);
        verify(streamOps).add(record.capture(), options.capture());

        assertThat(record.getValue().getStream()).isEqualTo(LocationPublisher.STREAM_KEY);
        assertThat(record.getValue().getValue()).containsOnlyKeys(LocationPublisher.PAYLOAD_FIELD);
        assertThat(mapper.readTree(record.getValue().getValue().get(LocationPublisher.PAYLOAD_FIELD)))
                .isEqualTo(published());
        assertThat(options.getValue().isApproximateTrimming()).isTrue();
        assertThat(options.getValue().getTrimOptions().getTrimStrategy())
                .isInstanceOfSatisfying(org.springframework.data.redis.connection.RedisStreamCommands
                        .MaxLenTrimStrategy.class, strategy -> assertThat(strategy.threshold()).isEqualTo(MAX_LEN));
    }

    @Test
    void goingOfflineIsAppendedToTheStreamToo() {
        publisher.publishOffline(driverId, Instant.parse("2026-11-11T07:05:00Z"));

        verify(streamOps).add(any(MapRecord.class), any(XAddOptions.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void aFailingChannelPublishDoesNotSkipTheStream() {
        doThrow(new RuntimeException("channel down")).when(redis).convertAndSend(anyString(), anyString());

        publisher.publish(driverId, new BigDecimal("10.5"), new BigDecimal("106.5"),
                Instant.parse("2026-11-11T07:00:00Z"), cloudnative.microservices.driver.entity.VehicleType.CAR);

        verify(streamOps).add(any(MapRecord.class), any(XAddOptions.class));
    }

    @Test
    void aFailingStreamAppendDoesNotSkipTheChannelOrThrow() {
        when(streamOps.add(any(MapRecord.class), any(XAddOptions.class)))
                .thenThrow(new RuntimeException("stream down"));

        publisher.publish(driverId, new BigDecimal("10.5"), new BigDecimal("106.5"),
                Instant.parse("2026-11-11T07:00:00Z"), cloudnative.microservices.driver.entity.VehicleType.CAR);

        assertThat(published().path("driverId").asString()).isEqualTo(driverId.toString());
    }
}