package cloudnative.microservices.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.realtime.service.NotificationRelay;
import cloudnative.microservices.realtime.websocket.SessionRegistry;
import java.net.URI;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/**
 * End-to-end through the real STOMP stack on a random port, with REAL clients.
 * Redis is switched off; the tests call {@link NotificationRelay#onMessage} - the
 * exact method the Redis listener calls - so everything after Redis is genuine.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "ridenow.gateway.redis.enabled=false")
class RealtimeGatewayIntegrationTest {

    @LocalServerPort private int port;
    @Autowired private NotificationRelay relay;
    @Autowired private SessionRegistry registry;

    private String url() {
        return "ws://localhost:" + port + "/ws";
    }

    private String notification(String userId, String eventId) {
        return """
                {"eventId":"%s","userId":"%s","type":"driver.accepted",
                 "message":"A driver has accepted your trip.","tripId":"t-1",
                 "occurredAt":"2026-11-11T07:00:00Z"}
                """.formatted(eventId, userId);
    }

    private WebSocketStompClient newClient() {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new StringMessageConverter());
        // Receipts (used to know a subscription is live) need a scheduler on the client.
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setDaemon(true);
        scheduler.setThreadNamePrefix("test-stomp-client-");
        scheduler.initialize();
        client.setTaskScheduler(scheduler);
        return client;
    }

    private StompSession connect(WebSocketStompClient client) throws Exception {
        return client.connectAsync(url(), new StompSessionHandlerAdapter() { })
                .get(10, TimeUnit.SECONDS);
    }

    /**
     * Publishes the notification repeatedly until it shows up in the inbox. A
     * SUBSCRIBE is asynchronous and the simple broker sends no confirmation, so the
     * first publish can race ahead of it; republishing the SAME event until the
     * first delivery avoids a sleep and still fails (after 10s) if delivery is broken.
     */
    private String publishUntilReceived(BlockingQueue<String> inbox, String userId, String eventId)
            throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            relay.onMessage(notification(userId, eventId));
            String pushed = inbox.poll(200, TimeUnit.MILLISECONDS);
            if (pushed != null) {
                return pushed;
            }
        }
        return null;
    }

    private BlockingQueue<String> subscribe(StompSession session, String userId) {
        BlockingQueue<String> received = new LinkedBlockingQueue<>();
        session.subscribe("/topic/users/" + userId, new StompFrameHandler() {
            @Override
            public java.lang.reflect.Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                received.add((String) payload);
            }
        });
        return received;
    }

    @Test
    void aNotificationReachesTheSubscribedUserAndOnlyThatUser() throws Exception {
        String alice = UUID.randomUUID().toString();
        String bob = UUID.randomUUID().toString();
        WebSocketStompClient client = newClient();
        StompSession session = connect(client);
        BlockingQueue<String> aliceInbox = subscribe(session, alice);
        BlockingQueue<String> bobInbox = subscribe(session, bob);

        String pushed = publishUntilReceived(aliceInbox, alice, "evt-1");

        assertThat(pushed).isNotNull()
                .contains("\"eventId\":\"evt-1\"")
                .contains("\"message\":\"A driver has accepted your trip.\"")
                .contains("\"occurredAt\":\"2026-11-11T07:00:00Z\"");
        assertThat(bobInbox.poll(500, TimeUnit.MILLISECONDS)).isNull();
        session.disconnect();
        client.stop();
    }

    @Test
    void aDroppedClientCanReconnectAndReceiveNewMessages() throws Exception {
        String user = UUID.randomUUID().toString();
        // Other tests share this server; measure against what was open before us.
        int baseline = registry.size();

        WebSocketStompClient first = newClient();
        StompSession firstSession = connect(first);
        BlockingQueue<String> firstInbox = subscribe(firstSession, user);
        assertThat(publishUntilReceived(firstInbox, user, "before-drop")).contains("before-drop");

        // The connection drops.
        firstSession.disconnect();
        first.stop();
        await().atMost(Duration.ofSeconds(10)).until(() -> registry.size() <= baseline);

        // A message sent while the user is offline is not buffered: Pub/Sub is
        // at-most-once. This is why clients re-fetch state over REST on reconnect.
        relay.onMessage(notification(user, "while-offline"));

        // The client reconnects (new socket, new subscription) and gets new messages.
        WebSocketStompClient second = newClient();
        StompSession secondSession = connect(second);
        BlockingQueue<String> secondInbox = subscribe(secondSession, user);
        String pushed = publishUntilReceived(secondInbox, user, "after-reconnect");

        assertThat(pushed).contains("after-reconnect").doesNotContain("while-offline");
        assertThat(secondInbox.stream().anyMatch(m -> m.contains("while-offline"))).isFalse();
        secondSession.disconnect();
        second.stop();
    }

    @Test
    void aWildcardSubscriptionIsRejectedAndNeverSeesOtherUsersMessages() throws Exception {
        List<Throwable> errors = new CopyOnWriteArrayList<>();
        BlockingQueue<String> snooped = new LinkedBlockingQueue<>();
        WebSocketStompClient client = newClient();
        StompSession session = client.connectAsync(url(), new StompSessionHandlerAdapter() {
            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                errors.add(new IllegalStateException("STOMP ERROR frame"));
            }

            @Override
            public void handleTransportError(StompSession s, Throwable exception) {
                errors.add(exception);
            }
        }).get(10, TimeUnit.SECONDS);

        session.subscribe("/topic/users/**", new StompFrameHandler() {
            @Override
            public java.lang.reflect.Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                snooped.add((String) payload);
            }
        });

        await().atMost(Duration.ofSeconds(10)).until(() -> !errors.isEmpty() || !session.isConnected());
        relay.onMessage(notification(UUID.randomUUID().toString(), "private-1"));

        assertThat(snooped.poll(500, TimeUnit.MILLISECONDS)).isNull();
        assertThat(session.isConnected()).isFalse();
        client.stop();
    }

    @Test
    void livenessIsUpEvenWithoutRedisButReadinessReflectsRedis() throws Exception {
        java.net.http.HttpClient http = java.net.http.HttpClient.newHttpClient();
        var base = "http://localhost:" + port + "/actuator/health/";

        var liveness = http.send(java.net.http.HttpRequest.newBuilder(URI.create(base + "liveness")).build(),
                java.net.http.HttpResponse.BodyHandlers.ofString());
        var readiness = http.send(java.net.http.HttpRequest.newBuilder(URI.create(base + "readiness")).build(),
                java.net.http.HttpResponse.BodyHandlers.ofString());

        // No Redis in this test: a Redis outage must not restart the pod (liveness
        // UP) but must take it out of rotation (readiness DOWN -> 503).
        assertThat(liveness.statusCode()).isEqualTo(200);
        assertThat(liveness.body()).contains("\"UP\"");
        assertThat(readiness.statusCode()).isEqualTo(503);
    }

    @Test
    void shuttingDownClosesOpenSocketsWithGoingAwayAndAReconnectReason() throws Exception {
        AtomicReference<CloseStatus> closed = new AtomicReference<>();
        CountDownLatch closedLatch = new CountDownLatch(1);
        WebSocketHandler handler = new TextWebSocketHandler() {
            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
                closed.set(status);
                closedLatch.countDown();
            }
        };
        CompletableFuture<WebSocketSession> connecting =
                new StandardWebSocketClient().execute(handler, null, URI.create(url()));
        WebSocketSession raw = connecting.get(10, TimeUnit.SECONDS);
        await().atMost(Duration.ofSeconds(10)).until(() -> registry.size() >= 1);

        int closedCount = registry.closeAllForRestart();

        assertThat(closedCount).isGreaterThanOrEqualTo(1);
        assertThat(closedLatch.await(10, TimeUnit.SECONDS)).isTrue();
        assertThat(closed.get().getCode()).isEqualTo(1001);
        assertThat(closed.get().getReason()).isEqualTo("reconnect");
        assertThat(raw.isOpen()).isFalse();
        // closeAllForRestart closes EVERY session on the pod, so none may remain.
        await().atMost(Duration.ofSeconds(10)).until(() -> registry.size() == 0);
    }
}
