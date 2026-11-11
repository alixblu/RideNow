package cloudnative.microservices.realtime.websocket;

import cloudnative.microservices.realtime.channel.Destinations;
import cloudnative.microservices.realtime.config.GatewayProperties;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.stereotype.Component;

/**
 * Guards what a client may do over its socket. Clients are receive-only:
 * <ul>
 *   <li>{@code SEND} is rejected - a client cannot publish into anyone's topic;</li>
 *   <li>{@code SUBSCRIBE} is allowed only to an exact per-user topic (no
 *       wildcards, which would leak every user's notifications) and only up to
 *       {@code maxSubscriptionsPerSession} times;</li>
 *   <li>any one connection is limited to {@code maxFramesPerWindow} frames per
 *       {@code frameWindow}, so a flooding client is cut off instead of costing the pod.</li>
 * </ul>
 * A rejected frame makes Spring answer with a STOMP ERROR frame and close the
 * connection. The frame-size cap itself is the transport's message size limit.
 *
 * Known gap: there is no authentication yet, so "a user's own topic" is only as
 * private as the user id is secret. JWT at CONNECT is the planned fix.
 */
@Component
public class InboundGuardInterceptor implements ChannelInterceptor {

    private final int maxSubscriptions;
    private final int maxFrames;
    private final long windowNanos;

    private final Map<String, SessionState> sessions = new ConcurrentHashMap<>();

    public InboundGuardInterceptor(GatewayProperties properties) {
        this.maxSubscriptions = properties.maxSubscriptionsPerSession();
        this.maxFrames = properties.maxFramesPerWindow();
        this.windowNanos = properties.frameWindow().toNanos();
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);
        StompCommand command = accessor.getCommand();
        String sessionId = accessor.getSessionId();
        if (command == null || sessionId == null) {
            return message; // heartbeat / non-STOMP internal message
        }

        if (command == StompCommand.DISCONNECT) {
            forget(sessionId);
            return message;
        }

        SessionState state = sessions.computeIfAbsent(sessionId, id -> new SessionState());
        if (!state.allowFrame(System.nanoTime(), windowNanos, maxFrames)) {
            throw new MessageDeliveryException("Too many frames; slow down");
        }

        switch (command) {
            case SEND -> throw new MessageDeliveryException("Clients may not send messages");
            case SUBSCRIBE -> {
                if (!Destinations.isUserTopic(accessor.getDestination())) {
                    throw new MessageDeliveryException("Subscription not allowed: " + accessor.getDestination());
                }
                if (!state.addSubscription(accessor.getSubscriptionId(), maxSubscriptions)) {
                    throw new MessageDeliveryException("Too many subscriptions on this connection");
                }
            }
            case UNSUBSCRIBE -> state.removeSubscription(accessor.getSubscriptionId());
            default -> { /* CONNECT and others pass through */ }
        }
        return message;
    }

    /** Drops the per-connection state; called when the connection closes. */
    public void forget(String sessionId) {
        sessions.remove(sessionId);
    }

    int trackedSessions() {
        return sessions.size();
    }

    /** Per-connection counters. Synchronized: frames of one session can arrive on different threads. */
    private static final class SessionState {
        private final Set<String> subscriptions = new HashSet<>();
        private long windowStart = System.nanoTime();
        private int frames;

        synchronized boolean allowFrame(long now, long windowNanos, int maxFrames) {
            if (now - windowStart >= windowNanos) {
                windowStart = now;
                frames = 0;
            }
            return ++frames <= maxFrames;
        }

        synchronized boolean addSubscription(String id, int max) {
            if (subscriptions.contains(id)) {
                return true; // re-subscribing the same id does not grow the set
            }
            if (subscriptions.size() >= max) {
                return false;
            }
            return subscriptions.add(id);
        }

        synchronized void removeSubscription(String id) {
            subscriptions.remove(id);
        }
    }
}
