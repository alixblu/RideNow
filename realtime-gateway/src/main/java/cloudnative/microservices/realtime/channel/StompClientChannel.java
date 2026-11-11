package cloudnative.microservices.realtime.channel;

import cloudnative.microservices.realtime.dto.GatewayMessage;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * {@link ClientChannel} over STOMP/WebSocket: publishes to the user's topic on the
 * in-memory simple broker, which delivers to whichever of this pod's connections
 * subscribed to it.
 */
@Component
public class StompClientChannel implements ClientChannel {

    private final SimpMessagingTemplate template;
    private final ObjectMapper objectMapper;

    public StompClientChannel(SimpMessagingTemplate template, ObjectMapper objectMapper) {
        this.template = template;
        this.objectMapper = objectMapper;
    }

    @Override
    public void send(String userId, GatewayMessage message) {
        template.convertAndSend(Destinations.forUser(userId), objectMapper.writeValueAsString(message));
    }
}
