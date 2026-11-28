package cloudnative.microservices.matching.event;

import cloudnative.microservices.matching.tracing.MessagingTracer;
import cloudnative.microservices.matching.tracing.TraceContextCarrier;
import io.opentelemetry.api.GlobalOpenTelemetry;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
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
import tools.jackson.databind.ObjectMapper;

/**
 * Polls the matching SQS queue (fed by an SNS subscription for trip.requested)
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
    private final MessagingTracer tracer;

    @Autowired
    public TripEventQueueConsumer(
            SqsClient sqs,
            TripRequestedHandler handler,
            ObjectMapper objectMapper,
            @Value("${ridenow.matching.queue-url}") String queueUrl,
            @Value("${ridenow.matching.poll.wait-seconds:10}") int waitSeconds,
            @Value("${ridenow.matching.poll.max-messages:10}") int maxMessages
    ) {
        this(sqs, handler, objectMapper, queueUrl, waitSeconds, maxMessages,
                new MessagingTracer(GlobalOpenTelemetry.get(),
                        new TraceContextCarrier(GlobalOpenTelemetry.getPropagators().getTextMapPropagator())));
    }

    public TripEventQueueConsumer(SqsClient sqs, TripRequestedHandler handler, ObjectMapper objectMapper,
                                  String queueUrl, int waitSeconds, int maxMessages, MessagingTracer tracer) {
        this.tracer = tracer;
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
                .messageAttributeNames(TraceContextCarrier.TRACEPARENT, TraceContextCarrier.XRAY)
                .build());

        for (Message message : response.messages()) {
            try {
                IncomingEvent event = null;
                Exception parseError = null;
                try {
                    event = parse(message.body());
                } catch (Exception ex) {
                    parseError = ex;
                }
                final IncomingEvent parsed = event;
                final Exception failure = parseError;
                tracer.consume(queueName(), message.messageId(), traceAttributes(message),
                        parsed == null ? null : parsed.type(), () -> {
                            if (failure != null) {
                                throw failure;
                            }
                            handler.handle(parsed);
                            sqs.deleteMessage(DeleteMessageRequest.builder()
                                    .queueUrl(queueUrl)
                                    .receiptHandle(message.receiptHandle())
                                    .build());
                        });
            } catch (Exception ex) {
                // Leave it on the queue: redelivered, then dead-lettered.
                log.warn("Failed to process message (will retry/DLQ): {}", ex.getMessage());
            }
        }
    }

    private String queueName() {
        return queueUrl.substring(queueUrl.lastIndexOf('/') + 1);
    }

    private static Map<String, String> traceAttributes(Message message) {
        Map<String, String> out = new HashMap<>();
        if (message.hasMessageAttributes()) {
            message.messageAttributes().forEach((k, v) -> {
                if (v != null && v.stringValue() != null) {
                    out.put(k, v.stringValue());
                }
            });
        }
        return out;
    }

    /**
     * Reads the event from the queue message. The SNS subscription uses raw message
     * delivery, so the body is the event JSON itself (no SNS envelope).
     */
    IncomingEvent parse(String body) {
        return objectMapper.readValue(body, IncomingEvent.class);
    }
}
