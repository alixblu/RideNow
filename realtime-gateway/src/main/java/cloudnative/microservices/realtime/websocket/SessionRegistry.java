package cloudnative.microservices.realtime.websocket;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/**
 * Tracks the live WebSocket sessions of this pod so they can be closed cleanly on
 * shutdown (a rolling deploy).
 *
 * On shutdown every session is closed with 1001 ("Going Away") and the reason
 * "reconnect". That tells the client the server is going down and it should
 * reconnect, and because clients reconnect with exponential backoff plus jitter,
 * a pod's connections spread across the other pods instead of stampeding. Without
 * this the sockets would just be cut and the clients would see an abnormal
 * closure.
 *
 * Why 1001 and not 1012 ("Service Restart"): 1001 is in RFC 6455's core set, so
 * every implementation accepts it. 1012 is only IANA-registered, and a strict
 * implementation (Tomcat's WebSocket client, observed in this repo's test)
 * treats it as a protocol error and reports 1002 instead - losing the signal.
 */
@Component
public class SessionRegistry {

    private static final Logger log = LoggerFactory.getLogger(SessionRegistry.class);

    static final CloseStatus RECONNECT = CloseStatus.GOING_AWAY.withReason("reconnect");

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    public void add(WebSocketSession session) {
        sessions.add(session);
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session);
    }

    public int size() {
        return sessions.size();
    }

    /** Fires at the very start of context shutdown, before the web server stops. */
    @EventListener(ContextClosedEvent.class)
    public void onShutdown() {
        closeAllForRestart();
    }

    /** Closes every open session with 1001 / "reconnect"; returns how many were closed. */
    public int closeAllForRestart() {
        int closed = 0;
        for (WebSocketSession session : sessions) {
            try {
                session.close(RECONNECT);
                closed++;
            } catch (IOException | RuntimeException ex) {
                log.debug("Could not close session {}: {}", session.getId(), ex.getMessage());
            }
        }
        if (closed > 0) {
            log.info("Closed {} WebSocket session(s) with 1001 (reconnect)", closed);
        }
        return closed;
    }
}
