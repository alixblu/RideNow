package cloudnative.microservices.payment.event;

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
    private TripEventHandler handler;
    private TripEventQueueConsumer consumer;

    private final UUID tripId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        sqs = mock(SqsClient.class);
        handler = mock(TripEventHandler.class);
        consumer = new TripEventQueueConsumer(sqs, handler, new ObjectMapper(), "http://q/payment", 0, 10);
    }

    private void queueHolds(String body) {
        when(sqs.receiveMessage(any(ReceiveMessageRequest.class))).thenReturn(
                ReceiveMessageResponse.builder()
                        .messages(Message.builder().body(body).receiptHandle("rh-1").build())
                        .build());
    }

    /** The raw-delivery body: the event JSON itself, with no SNS envelope. */
    private String rawEvent() {
        return """
                {"eventId":"%s","type":"trip.completed","aggregateId":"%s",
                 "data":{"tripId":"%s","finalFare":"52000.00"}}
                """.formatted(UUID.randomUUID(), tripId, tripId);
    }
    @Test
    void successfulMessageIsHandledFromTheRawBodyAndDeleted() {
        queueHolds(rawEvent());

        consumer.poll();

        var captor = org.mockito.ArgumentCaptor.forClass(IncomingEvent.class);
        verify(handler).handle(captor.capture());
        assertThat(captor.getValue().type()).isEqualTo("trip.completed");
        assertThat(captor.getValue().data()).containsEntry("tripId", tripId.toString());
        verify(sqs).deleteMessage(any(DeleteMessageRequest.class));
    }

    @Test
    void failedMessageIsLeftOnTheQueueForRetry() {
        queueHolds(rawEvent());
        doThrow(new IllegalStateException("db down")).when(handler).handle(any());

        consumer.poll();

        verify(sqs, never()).deleteMessage(any(DeleteMessageRequest.class));
    }

    @Test
    void unparseableMessageIsLeftOnTheQueueSoItReachesTheDlq() {
        queueHolds("this is not json");

        consumer.poll();

        verify(sqs, never()).deleteMessage(any(DeleteMessageRequest.class));
    }

    @Test
    void receiveRequestAsksForBothTraceMessageAttributes() {
        queueHolds(rawEvent());

        consumer.poll();

        var captor = org.mockito.ArgumentCaptor.forClass(ReceiveMessageRequest.class);
        verify(sqs).receiveMessage(captor.capture());
        assertThat(captor.getValue().messageAttributeNames())
                .containsExactlyInAnyOrder("traceparent", "X-Amzn-Trace-Id");
    }
}
