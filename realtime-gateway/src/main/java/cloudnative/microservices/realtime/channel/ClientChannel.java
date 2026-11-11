package cloudnative.microservices.realtime.channel;

import cloudnative.microservices.realtime.dto.GatewayMessage;

/**
 * The seam between "a notification arrived for this user" and "how bytes reach
 * the user's device". Everything upstream (the Redis relay) talks only to this
 * interface, so replacing WebSocket/STOMP with SSE or another transport changes
 * one class, not the rest of the gateway.
 */
public interface ClientChannel {

    /** Pushes the message to every live connection of the user. A user with none is a no-op. */
    void send(String userId, GatewayMessage message);
}
