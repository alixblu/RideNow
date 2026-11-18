package cloudnative.microservices.payment.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.PublishRequest;
import software.amazon.awssdk.services.sns.model.PublishResponse;
import tools.jackson.databind.ObjectMapper;

/**
 * Publishes {@link DomainEvent}s to an Amazon SNS topic via the AWS SDK v2.
 *
 * Active only under the "sns" profile; it then replaces the logging publisher as
 * the {@link DomainEventPublisher} bean (a pure substitution behind the
 * interface). The message body is the event serialized as JSON. Consumers' queue
 * subscriptions use raw message delivery, so the SQS body is exactly this JSON,
 * and they filter on its top-level "type" field (FilterPolicyScope=MessageBody),
 * so no message attributes are needed.
 */
@Component
@Profile("sns")
public class SnsDomainEventPublisher implements DomainEventPublisher {

    private static final Logger log = LoggerFactory.getLogger(SnsDomainEventPublisher.class);

    private final SnsClient client;
    private final ObjectMapper objectMapper;
    private final String topicArn;

    public SnsDomainEventPublisher(
            SnsClient client,
            ObjectMapper objectMapper,
            @Value("${RIDENOW_EVENTS_TOPIC_ARN:arn:aws:sns:ap-southeast-1:000000000000:ridenow-local-events}")
            String topicArn
    ) {
        this.client = client;
        this.objectMapper = objectMapper;
        this.topicArn = topicArn;
    }

    @Override
    public void publish(DomainEvent event) {
        PublishResponse response = client.publish(PublishRequest.builder()
                .topicArn(topicArn)
                .message(objectMapper.writeValueAsString(event))
                .build());

        log.info("Published event type={} eventId={} to topic={} messageId={}",
                event.type(), event.eventId(), topicArn, response.messageId());
    }
}
