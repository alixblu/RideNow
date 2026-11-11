package cloudnative.microservices.matching.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;
import tools.jackson.databind.ObjectMapper;

/** Delete-on-success / leave-on-failure behavior of the SQS poller, with SQS mocked. */
class TripEventQueueConsumerTest {

    private SqsClient sqs;
    private TripRequestedHandler handler;
    private TripEventQueueConsumer consumer;

    private final UUID tripId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        sqs = mock(SqsClient.class);
        handler = mock(TripRequestedHandler.class);
        consumer = new TripEventQueueConsumer(sqs, handler, new ObjectMapper(), "http://q/matching", 0, 10);
    }

    private void queueHolds(String body) {
        when(sqs.receiveMessage(any(ReceiveMessageRequest.class))).thenReturn(
                ReceiveMessageResponse.builder()
                        .messages(Message.builder().body(body).receiptHandle("rh-1").build())
                        .build());
    }

    private String envelope() {
        return """
                {"version":"0","detail-type":"trip.requested","source":"ridenow.trip",
                 "detail":{"eventId":"%s","type":"trip.requested","aggregateId":"%s",
                           "data":{"tripId":"%s","rideType":"CAR","pickupLat":"10.7","pickupLng":"106.6"}}}
                """.formatted(UUID.randomUUID(), tripId, tripId);
    }

    @Test
    void successfulMessageIsHandledFromTheEventBridgeEnvelopeAndDeleted() {
        queueHolds(envelope());

        consumer.poll();

        var captor = org.mockito.ArgumentCaptor.forClass(IncomingEvent.class);
        verify(handler).handle(captor.capture());
        assertThat(captor.getValue().type()).isEqualTo("trip.requested");
        assertThat(captor.getValue().data()).containsEntry("rideType", "CAR");
        verify(sqs).deleteMessage(any(DeleteMessageRequest.class));
    }

    @Test
    void failedMessageIsLeftOnTheQueueForRetry() {
        queueHolds(envelope());
        doThrow(new IllegalStateException("redis down")).when(handler).handle(any());

        consumer.poll();

        verify(sqs, never()).deleteMessage(any(DeleteMessageRequest.class));
    }

    @Test
    void unparseableMessageIsLeftOnTheQueueSoItReachesTheDlq() {
        queueHolds("this is not json");

        consumer.poll();

        verify(sqs, never()).deleteMessage(any(DeleteMessageRequest.class));
    }
}
