package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.Notification;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Hands a notification to the realtime-gateway by publishing it on a Redis
 * Pub/Sub channel. Every gateway pod subscribes; the one holding the recipient's
 * WebSocket pushes it.
 *
 * The JSON shape is the gateway's contract: eventId, userId, type, message,
 * tripId, occurredAt (see realtime-gateway's GatewayMessage).
 *
 * Delivery semantics, honestly: a Redis publish failure throws, so the SQS
 * message is retried - the worker side is at-least-once. But Pub/Sub itself is
 * at-most-once: a recipient with no live socket at that instant just misses it.
 * Clients therefore re-fetch state over REST on reconnect and de-duplicate by
 * eventId.
 */
public class RedisNotificationSender implements NotificationSender {

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final String channel;

    public RedisNotificationSender(StringRedisTemplate redis, ObjectMapper objectMapper, String channel) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.channel = channel;
    }

    @Override
    public void send(Notification notification) {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("eventId", notification.eventId().toString());
        payload.put("userId", notification.userId().toString());
        payload.put("type", notification.type());
        payload.put("message", notification.message());
        payload.put("tripId", notification.tripId());
        payload.put("occurredAt", notification.occurredAt());
        redis.convertAndSend(channel, objectMapper.writeValueAsString(payload));
    }
}
