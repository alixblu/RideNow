package cloudnative.microservices.matching.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.DeleteMessageRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Polls the matching SQS queue (fed by the EventBridge rule for trip.requested)
 * and hands each event to {@link TripRequestedHandler}.
 *
 * A message is deleted only after the handler returns. If it throws, the message
 * is left on the queue: SQS redelivers it after the visibility timeout, up to the
 * queue's maxReceiveCount, after which it lands in the dead-letter queue.
 *
 * Active only when a queue URL is configured (ridenow.matching.queue-url).
 */
@Component
@ConditionalOnProperty(name = "ridenow.matching.queue-url")
public class TripEventQueueConsumer {

    private static final Logger log = LoggerFactory.getLogger(TripEventQueueConsumer.class);

    private final SqsClient sqs;
    private final TripRequestedHandler handler;
    private final ObjectMapper objectMapper;
    private final String queueUrl;
    private final int waitSeconds;
    private final int maxMessages;

    public TripEventQueueConsumer(
            SqsClient sqs,
            TripRequestedHandler handler,
            ObjectMapper objectMapper,
            @Value("${ridenow.matching.queue-url}") String queueUrl,
            @Value("${ridenow.matching.poll.wait-seconds:10}") int waitSeconds,
            @Value("${ridenow.matching.poll.max-messages:10}") int maxMessages
    ) {
        this.sqs = sqs;
        this.handler = handler;
        this.objectMapper = objectMapper;
        this.queueUrl = queueUrl;
        this.waitSeconds = waitSeconds;
        this.maxMessages = maxMessages;
    }

    /** One polling cycle. Scheduled back-to-back; long polling bounds the rate. */
    @Scheduled(fixedDelayString = "${ridenow.matching.poll.fixed-delay-ms:1000}")
    public void poll() {
        var response = sqs.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .maxNumberOfMessages(maxMessages)
                .waitTimeSeconds(waitSeconds)
                .build());

        for (Message message : response.messages()) {
            try {
                handler.handle(parse(message.body()));
                sqs.deleteMessage(DeleteMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .receiptHandle(message.receiptHandle())
                        .build());
            } catch (Exception ex) {
                // Leave it on the queue: redelivered, then dead-lettered.
                log.warn("Failed to process message (will retry/DLQ): {}", ex.getMessage());
            }
        }
    }

    /**
     * Reads the event from an EventBridge-to-SQS message, which wraps it under a
     * top-level "detail" field; without "detail" the whole body is the event.
     */
    IncomingEvent parse(String body) {
        JsonNode root = objectMapper.readTree(body);
        JsonNode detail = root.get("detail");
        JsonNode eventNode = (detail != null && !detail.isNull()) ? detail : root;
        return objectMapper.treeToValue(eventNode, IncomingEvent.class);
    }
}
