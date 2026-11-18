package cloudnative.microservices.payment.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.payment.entity.Payment;
import cloudnative.microservices.payment.entity.PaymentMethod;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Publish-path verification for payment-service: a payment.succeeded event
 * published through {@link SnsDomainEventPublisher} reaches the unfiltered
 * notifications queue as raw event JSON, and is filtered out of the payment queue
 * (which only wants trip.completed / trip.cancelled). Self-contained; skipped when
 * Docker is unavailable.
 */
@Testcontainers
class SnsToSqsIntegrationTest {

    private static final String TOPIC = "ridenow-local-events";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Container
    static final LocalStackContainer LOCALSTACK =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:3"));

    static SqsClient sqs;
    static SnsClient sns;
    static String topicArn;
    static String paymentUrl;
    static String notificationsUrl;

    @BeforeAll
    static void provision() {
        URI endpoint = LOCALSTACK.getEndpoint();
        var creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(LOCALSTACK.getAccessKey(), LOCALSTACK.getSecretKey()));
        Region region = Region.of(LOCALSTACK.getRegion());

        sqs = SqsClient.builder().endpointOverride(endpoint).region(region).credentialsProvider(creds).build();
        sns = SnsClient.builder().endpointOverride(endpoint).region(region).credentialsProvider(creds).build();

        topicArn = sns.createTopic(b -> b.name(TOPIC)).topicArn();
        paymentUrl = subscribeQueue("ridenow-local-payment", "{\"type\":[\"trip.completed\",\"trip.cancelled\"]}");
        notificationsUrl = subscribeQueue("ridenow-local-notifications", null);
    }

    /** Creates a queue and subscribes it with raw delivery and an optional body filter. */
    private static String subscribeQueue(String name, String filterPolicy) {
        String url = sqs.createQueue(b -> b.queueName(name)).queueUrl();
        String arn = sqs.getQueueAttributes(b -> b.queueUrl(url).attributeNames(QueueAttributeName.QUEUE_ARN))
                .attributes().get(QueueAttributeName.QUEUE_ARN);

        String policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\","
                + "\"Principal\":{\"Service\":\"sns.amazonaws.com\"},\"Action\":\"sqs:SendMessage\","
                + "\"Resource\":\"" + arn + "\","
                + "\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"" + topicArn + "\"}}}]}";
        sqs.setQueueAttributes(b -> b.queueUrl(url).attributes(Map.of(QueueAttributeName.POLICY, policy)));

        Map<String, String> attributes = new HashMap<>();
        attributes.put("RawMessageDelivery", "true");
        if (filterPolicy != null) {
            attributes.put("FilterPolicy", filterPolicy);
            attributes.put("FilterPolicyScope", "MessageBody");
        }
        sns.subscribe(b -> b.topicArn(topicArn).protocol("sqs").endpoint(arn).attributes(attributes));
        return url;
    }

    @AfterAll
    static void close() {
        if (sqs != null) sqs.close();
        if (sns != null) sns.close();
    }

    @Test
    void paymentSucceededReachesNotificationsAsRawJsonButNotThePaymentQueue() {
        DomainEventPublisher publisher = new SnsDomainEventPublisher(sns, MAPPER, topicArn);

        Payment payment = new Payment(UUID.randomUUID(), UUID.randomUUID(), new BigDecimal("45000.00"),
                "VND", PaymentMethod.CASH, "idem-it-1", Instant.now());
        payment.markProcessing(Instant.now());
        payment.markPaid(Instant.now());
        DomainEvent event = PaymentEvents.paymentSucceeded(payment, null);

        publisher.publish(event);

        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            List<Message> messages = receive(notificationsUrl);
            assertThat(messages).hasSize(1);
            JsonNode body = MAPPER.readTree(messages.get(0).body());
            assertThat(body.get("type").asString()).isEqualTo(PaymentEvents.PAYMENT_SUCCEEDED);
            assertThat(body.get("eventId").asString()).isEqualTo(event.eventId().toString());
            assertThat(body.has("Message")).isFalse();
        });

        assertThat(receive(paymentUrl)).isEmpty();
    }

    private static List<Message> receive(String url) {
        return sqs.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(url)
                .maxNumberOfMessages(10)
                .waitTimeSeconds(2)
                .build()).messages();
    }
}
