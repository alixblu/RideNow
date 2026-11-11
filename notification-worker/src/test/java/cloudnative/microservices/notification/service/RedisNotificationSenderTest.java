package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.notification.dto.Notification;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Pins the JSON contract the realtime-gateway reads (its GatewayMessage). */
class RedisNotificationSenderTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void publishesTheGatewayContractOnTheConfiguredChannel() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        RedisNotificationSender sender = new RedisNotificationSender(redis, objectMapper, "ridenow.notifications");
        UUID eventId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();

        sender.send(new Notification(eventId, userId, "driver.accepted",
                "A driver has accepted your trip.", "trip-1", "2026-11-11T07:00:00Z"));

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(redis).convertAndSend(eq("ridenow.notifications"), json.capture());
        JsonNode body = objectMapper.readTree(json.getValue());
        assertThat(body.get("eventId").asText()).isEqualTo(eventId.toString());
        assertThat(body.get("userId").asText()).isEqualTo(userId.toString());
        assertThat(body.get("type").asText()).isEqualTo("driver.accepted");
        assertThat(body.get("message").asText()).isEqualTo("A driver has accepted your trip.");
        assertThat(body.get("tripId").asText()).isEqualTo("trip-1");
        assertThat(body.get("occurredAt").asText()).isEqualTo("2026-11-11T07:00:00Z");
    }

    @Test
    void aRedisFailurePropagatesSoTheSqsMessageIsRetried() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.convertAndSend(anyString(), anyString()))
                .thenThrow(new RedisConnectionFailureException("down"));
        RedisNotificationSender sender = new RedisNotificationSender(redis, objectMapper, "ch");

        assertThatThrownBy(() -> sender.send(new Notification(
                UUID.randomUUID(), UUID.randomUUID(), "t", "m", null, null)))
                .isInstanceOf(RedisConnectionFailureException.class);
    }
}
