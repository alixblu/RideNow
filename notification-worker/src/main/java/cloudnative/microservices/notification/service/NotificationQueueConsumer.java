package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.IncomingEvent;
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
 * Polls the SQS notifications queue and processes each message exactly once.
 *
 * Flow per message:
 *   1. receive (long poll)
 *   2. extract the "detail" object (the DomainEvent) from the EventBridge envelope
 *   3. hand it to NotificationService (idempotent send + ledger)
 *   4. delete on success
 *
 * On failure we do NOT delete: SQS makes the message visible again after the
 * visibility timeout and redelivers it, up to the queue's maxReceiveCount, after
 * which it lands in the dead-letter queue. That is the retry + DLQ behavior.
 *
 * Active only when a queue URL is configured (so unit tests without SQS skip it).
 */
@Component
@ConditionalOnProperty(name = "ridenow.notifications.queue-url")
public class NotificationQueueConsumer {

    private static final Logger log = LoggerFactory.getLogger(NotificationQueueConsumer.class);

    private final SqsClient sqs;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper;
    private final String queueUrl;
    private final int waitSeconds;
    private final int maxMessages;

    public NotificationQueueConsumer(
            SqsClient sqs,
            NotificationService notificationService,
            ObjectMapper objectMapper,
            @Value("${ridenow.notifications.queue-url}") String queueUrl,
            @Value("${ridenow.notifications.poll.wait-seconds:10}") int waitSeconds,
            @Value("${ridenow.notifications.poll.max-messages:10}") int maxMessages
    ) {
        this.sqs = sqs;
        this.notificationService = notificationService;
        this.objectMapper = objectMapper;
        this.queueUrl = queueUrl;
        this.waitSeconds = waitSeconds;
        this.maxMessages = maxMessages;
    }

    /** One polling cycle. Scheduled back-to-back; long polling bounds the rate. */
    @Scheduled(fixedDelayString = "${ridenow.notifications.poll.fixed-delay-ms:1000}")
    public void poll() {
        var response = sqs.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(queueUrl)
                .maxNumberOfMessages(maxMessages)
                .waitTimeSeconds(waitSeconds)
                .build());

        for (Message message : response.messages()) {
            try {
                IncomingEvent event = parse(message.body());
                notificationService.handle(event);
                sqs.deleteMessage(DeleteMessageRequest.builder()
                        .queueUrl(queueUrl)
                        .receiptHandle(message.receiptHandle())
                        .build());
            } catch (Exception ex) {
                // Leave the message on the queue: it becomes visible again and is
                // redelivered, then dead-lettered after maxReceiveCount.
                log.warn("Failed to process message (will retry/DLQ): {}", ex.getMessage());
            }
        }
    }

    /**
     * Reads the DomainEvent from an EventBridge-to-SQS message. EventBridge wraps
     * the event under a top-level "detail" field; if "detail" is absent (e.g. a
     * message sent straight to the queue) we treat the whole body as the event.
     */
    private IncomingEvent parse(String body) {
        JsonNode root = objectMapper.readTree(body);
        JsonNode detail = root.get("detail");
        JsonNode eventNode = (detail != null && !detail.isNull()) ? detail : root;
        return objectMapper.treeToValue(eventNode, IncomingEvent.class);
    }
}
