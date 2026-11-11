package cloudnative.microservices.realtime.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import cloudnative.microservices.realtime.channel.ClientChannel;
import cloudnative.microservices.realtime.dto.GatewayMessage;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;

class NotificationRelayTest {

    private ClientChannel channel;
    private NotificationRelay relay;

    private final String userId = UUID.randomUUID().toString();

    @BeforeEach
    void setUp() {
        channel = mock(ClientChannel.class);
        relay = new NotificationRelay(new ObjectMapper(), channel);
    }

    private String json(String eventId, String userIdValue) {
        return """
                {"eventId":%s,"userId":%s,"type":"driver.accepted",
                 "message":"A driver has accepted your trip.","tripId":"t-1",
                 "occurredAt":"2026-11-11T07:00:00Z","somethingNew":"ignored"}
                """.formatted(eventId == null ? "null" : "\"" + eventId + "\"",
                userIdValue == null ? "null" : "\"" + userIdValue + "\"");
    }

    @Test
    void validMessageIsPushedToTheUsersChannel() {
        relay.onMessage(json("e-1", userId));

        ArgumentCaptor<GatewayMessage> captor = ArgumentCaptor.forClass(GatewayMessage.class);
        verify(channel).send(eq(userId), captor.capture());
        assertThat(captor.getValue().eventId()).isEqualTo("e-1");
        assertThat(captor.getValue().message()).isEqualTo("A driver has accepted your trip.");
        assertThat(captor.getValue().occurredAt()).isEqualTo("2026-11-11T07:00:00Z");
    }

    @Test
    void uppercaseUserIdIsCanonicalisedToLowercase() {
        relay.onMessage(json("e-1", userId.toUpperCase()));

        verify(channel).send(eq(userId), any());
    }

    @Test
    void anUserIdThatIsNotAUuidIsDroppedSoItCanNeverInjectATopicPattern() {
        relay.onMessage(json("e-1", "**"));
        relay.onMessage(json("e-2", "../admin"));
        relay.onMessage(json("e-3", userId + "/extra"));

        verifyNoInteractions(channel);
    }

    @Test
    void malformedOrIncompleteMessagesAreDropped() {
        relay.onMessage("not json at all");
        relay.onMessage("null");
        relay.onMessage(json(null, userId));
        relay.onMessage(json("e-1", null));

        verifyNoInteractions(channel);
    }

    @Test
    void aFailingChannelNeverThrowsBackIntoTheRedisListener() {
        doThrow(new IllegalStateException("broker down")).when(channel).send(any(), any());

        relay.onMessage(json("e-1", userId)); // must not throw
    }
}
