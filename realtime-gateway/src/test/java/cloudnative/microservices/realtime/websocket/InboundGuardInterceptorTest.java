package cloudnative.microservices.realtime.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import cloudnative.microservices.realtime.config.GatewayProperties;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.MessageBuilder;

class InboundGuardInterceptorTest {

    private InboundGuardInterceptor guard;

    private final String userTopic = "/topic/users/" + UUID.randomUUID();

    @BeforeEach
    void setUp() {
        guard = guardWith(2, 100);
    }

    private static InboundGuardInterceptor guardWith(int maxSubscriptions, int maxFrames) {
        return new InboundGuardInterceptor(new GatewayProperties(
                "ch", List.of("*"), 8192, maxSubscriptions, maxFrames,
                Duration.ofSeconds(60), Duration.ofSeconds(10)));
    }

    private Message<byte[]> frame(StompCommand command, String session, String destination, String subscriptionId) {
        StompHeaderAccessor accessor = StompHeaderAccessor.create(command);
        accessor.setSessionId(session);
        if (destination != null) {
            accessor.setDestination(destination);
        }
        if (subscriptionId != null) {
            accessor.setSubscriptionId(subscriptionId);
        }
        accessor.setLeaveMutable(true);
        return MessageBuilder.createMessage(new byte[0], accessor.getMessageHeaders());
    }

    private void send(StompCommand command, String session, String destination, String subscriptionId) {
        guard.preSend(frame(command, session, destination, subscriptionId), null);
    }

    @Test
    void subscribingToOwnUserTopicIsAllowed() {
        assertThatCode(() -> send(StompCommand.SUBSCRIBE, "s1", userTopic, "sub-0")).doesNotThrowAnyException();
    }

    @Test
    void clientsCannotSendMessages() {
        assertThatThrownBy(() -> send(StompCommand.SEND, "s1", userTopic, null))
                .isInstanceOf(MessageDeliveryException.class);
    }

    @Test
    void wildcardAndForeignDestinationsAreRejected() {
        for (String destination : List.of(
                "/topic/users/**", "/topic/users/*", "/topic/**", "/topic/users/", "/topic/other",
                "/topic/users/" + UUID.randomUUID().toString().toUpperCase(),
                userTopic + "/extra", "/queue/x")) {
            assertThatThrownBy(() -> send(StompCommand.SUBSCRIBE, "s1", destination, "sub-x"))
                    .as(destination)
                    .isInstanceOf(MessageDeliveryException.class);
        }
    }

    @Test
    void aConnectionCannotHoldMoreSubscriptionsThanTheCap() {
        send(StompCommand.SUBSCRIBE, "s1", userTopic, "sub-0");
        send(StompCommand.SUBSCRIBE, "s1", userTopic, "sub-1");

        assertThatThrownBy(() -> send(StompCommand.SUBSCRIBE, "s1", userTopic, "sub-2"))
                .isInstanceOf(MessageDeliveryException.class);

        // Freeing one makes room again; re-using an existing id never counts twice.
        send(StompCommand.UNSUBSCRIBE, "s1", null, "sub-0");
        assertThatCode(() -> send(StompCommand.SUBSCRIBE, "s1", userTopic, "sub-2")).doesNotThrowAnyException();
        assertThatCode(() -> send(StompCommand.SUBSCRIBE, "s1", userTopic, "sub-1")).doesNotThrowAnyException();
    }

    @Test
    void aFloodingConnectionIsCutOffButOthersAreUnaffected() {
        guard = guardWith(2, 5);
        for (int i = 0; i < 5; i++) {
            send(StompCommand.CONNECT, "flood", null, null);
        }
        assertThatThrownBy(() -> send(StompCommand.CONNECT, "flood", null, null))
                .isInstanceOf(MessageDeliveryException.class)
                .hasMessageContaining("Too many frames");

        assertThatCode(() -> send(StompCommand.CONNECT, "calm", null, null)).doesNotThrowAnyException();
    }

    @Test
    void disconnectForgetsTheConnectionsState() {
        send(StompCommand.CONNECT, "s1", null, null);
        assertThat(guard.trackedSessions()).isEqualTo(1);

        send(StompCommand.DISCONNECT, "s1", null, null);

        assertThat(guard.trackedSessions()).isZero();
    }

    @Test
    void framesWithoutACommandAreHeartbeatsAndPassThrough() {
        StompHeaderAccessor heartbeat = StompHeaderAccessor.createForHeartbeat();
        heartbeat.setSessionId("s1");
        Message<byte[]> message = MessageBuilder.createMessage(new byte[0], heartbeat.getMessageHeaders());

        assertThat(guard.preSend(message, null)).isSameAs(message);
        assertThat(guard.trackedSessions()).isZero();
    }
}
