package cloudnative.microservices.realtime.service;

import cloudnative.microservices.realtime.channel.ClientChannel;
import cloudnative.microservices.realtime.dto.GatewayMessage;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Takes one raw message from the Redis notifications channel and hands it to the
 * {@link ClientChannel}. Redis Pub/Sub is fire-and-forget, so nothing here may
 * throw back into the listener, and nothing is retried: a message that cannot be
 * delivered is logged and dropped (the client re-syncs over REST on reconnect).
 */
@Service
public class NotificationRelay {

    private static final Logger log = LoggerFactory.getLogger(NotificationRelay.class);

    private final ObjectMapper objectMapper;
    private final ClientChannel clientChannel;

    public NotificationRelay(ObjectMapper objectMapper, ClientChannel clientChannel) {
        this.objectMapper = objectMapper;
        this.clientChannel = clientChannel;
    }

    public void onMessage(String json) {
        GatewayMessage message;
        try {
            message = objectMapper.readValue(json, GatewayMessage.class);
        } catch (RuntimeException ex) {
            log.warn("Dropping unparseable notification: {}", ex.getMessage());
            return;
        }
        if (message == null || message.eventId() == null || message.userId() == null) {
            log.warn("Dropping notification without eventId/userId");
            return;
        }

        // The user id becomes part of a topic name, so it must be a real UUID
        // (canonicalised to lowercase) - never free text from the wire.
        String userId;
        try {
            userId = UUID.fromString(message.userId()).toString();
        } catch (IllegalArgumentException ex) {
            log.warn("Dropping notification {} with invalid userId", message.eventId());
            return;
        }

        try {
            clientChannel.send(userId, message);
        } catch (RuntimeException ex) {
            log.warn("Could not push notification {} to user {}: {}", message.eventId(), userId, ex.getMessage());
        }
    }
}
