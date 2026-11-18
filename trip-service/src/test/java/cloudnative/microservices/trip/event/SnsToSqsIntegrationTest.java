package cloudnative.microservices.trip.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.Trip;
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
 * Publish-path verification: a DomainEvent published through
 * {@link SnsDomainEventPublisher} to the SNS topic reaches exactly the queues whose
 * subscription filter matches its "type", with the event JSON as the raw SQS body.
 *
 * The test provisions the same footprint the compose init script creates (topic,
 * three queues, raw-delivery subscriptions with body-scope filters; notifications
 * unfiltered) against LocalStack. It is skipped automatically when Docker is not
 * available.
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
    static String matchingUrl;
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

        matchingUrl = subscribeQueue("ridenow-local-matching", "{\"type\":[\"trip.requested\"]}");
        paymentUrl = subscribeQueue("ridenow-local-payment",
                "{\"type\":[\"trip.completed\",\"trip.cancelled\"]}");
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
    void tripCompletedReachesPaymentAndNotificationsAsRawJsonButNotMatching() {
        DomainEventPublisher publisher = new SnsDomainEventPublisher(sns, MAPPER, topicArn);

        Trip trip = new Trip(UUID.randomUUID(), UUID.randomUUID(), RideType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"),
                new BigDecimal("10.100000"), new BigDecimal("106.100000"),
                new BigDecimal("45000.00"), Instant.now());
        DomainEvent event = TripEvents.tripCompleted(trip);

        publisher.publish(event);

        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            List<Message> payment = receive(paymentUrl);
            assertThat(payment).hasSize(1);
            // Raw delivery: the body IS the event, not an SNS envelope.
            JsonNode body = MAPPER.readTree(payment.get(0).body());
            assertThat(body.get("type").asString()).isEqualTo(TripEvents.TRIP_COMPLETED);
            assertThat(body.get("eventId").asString()).isEqualTo(event.eventId().toString());
            assertThat(body.has("Message")).isFalse();
        });
        await().atMost(Duration.ofSeconds(20)).untilAsserted(() ->
                assertThat(receive(notificationsUrl))
                        .anyMatch(m -> m.body().contains(event.eventId().toString())));

        // Filtered out: matching only wants trip.requested.
        assertThat(receive(matchingUrl)).isEmpty();
    }

    private static List<Message> receive(String url) {
        return sqs.receiveMessage(ReceiveMessageRequest.builder()
                .queueUrl(url)
                .maxNumberOfMessages(10)
                .waitTimeSeconds(2)
                .build()).messages();
    }
}
