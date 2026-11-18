package cloudnative.microservices.payment.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.payment.entity.Payment;
import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.entity.PaymentStatus;
import cloudnative.microservices.payment.repository.PaymentRepository;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.localstack.LocalStackContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

/**
 * Queue -> consumer -> database, end to end on LocalStack + Postgres. The topic,
 * queue, DLQ and subscription are created like {@code localstack/init/01-messaging.sh}
 * (payment subscription: raw delivery, body filter on {@code trip.completed} and
 * {@code trip.cancelled}), except that the redrive count is 2 and the visibility
 * timeout 1s, to keep the DLQ test fast.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class PaymentQueueConsumerIntegrationTest {

    static final String TOPIC = "ridenow-local-events";
    static final String QUEUE = "ridenow-local-payment";
    static final String DLQ = "ridenow-local-payment-dlq";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17").withDatabaseName("payment_service");
    @Container
    static final LocalStackContainer LOCALSTACK =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:3"));

    static SqsClient sqs;
    static SnsClient sns;
    static String topicArn;
    static String queueUrl;
    static String dlqUrl;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        LOCALSTACK.start();
        URI endpoint = LOCALSTACK.getEndpoint();
        var creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(LOCALSTACK.getAccessKey(), LOCALSTACK.getSecretKey()));
        Region region = Region.of(LOCALSTACK.getRegion());
        sqs = SqsClient.builder().endpointOverride(endpoint).region(region).credentialsProvider(creds).build();
        sns = SnsClient.builder().endpointOverride(endpoint).region(region)
                .credentialsProvider(creds).build();

        topicArn = sns.createTopic(b -> b.name(TOPIC)).topicArn();
        dlqUrl = sqs.createQueue(b -> b.queueName(DLQ)).queueUrl();
        String dlqArn = arn(dlqUrl);
        String redrive = "{\"deadLetterTargetArn\":\"" + dlqArn + "\",\"maxReceiveCount\":\"2\"}";
        queueUrl = sqs.createQueue(b -> b.queueName(QUEUE).attributes(Map.of(
                QueueAttributeName.REDRIVE_POLICY, redrive,
                QueueAttributeName.VISIBILITY_TIMEOUT, "1"))).queueUrl();
        String queueArn = arn(queueUrl);
        String policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\","
                + "\"Principal\":{\"Service\":\"sns.amazonaws.com\"},\"Action\":\"sqs:SendMessage\","
                + "\"Resource\":\"" + queueArn + "\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\""
                + topicArn + "\"}}}]}";
        sqs.setQueueAttributes(b -> b.queueUrl(queueUrl).attributes(Map.of(QueueAttributeName.POLICY, policy)));
        sns.subscribe(b -> b.topicArn(topicArn).protocol("sqs").endpoint(queueArn).attributes(Map.of(
                "RawMessageDelivery", "true",
                "FilterPolicyScope", "MessageBody",
                "FilterPolicy", "{\"type\":[\"trip.completed\",\"trip.cancelled\"]}")));
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("ridenow.payment.queue-url", () -> queueUrl);
        registry.add("ridenow.payment.poll.wait-seconds", () -> "1");
        registry.add("ridenow.payment.poll.fixed-delay-ms", () -> "300");
        registry.add("AWS_REGION", LOCALSTACK::getRegion);
        registry.add("AWS_ENDPOINT", () -> LOCALSTACK.getEndpoint().toString());
        registry.add("AWS_ACCESS_KEY_ID", LOCALSTACK::getAccessKey);
        registry.add("AWS_SECRET_ACCESS_KEY", LOCALSTACK::getSecretKey);
    }

    @AfterAll
    static void close() {
        if (sqs != null) sqs.close();
        if (sns != null) sns.close();
    }

    private static String arn(String url) {
        return sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                        .queueUrl(url).attributeNames(QueueAttributeName.QUEUE_ARN).build())
                .attributes().get(QueueAttributeName.QUEUE_ARN);
    }

    @Autowired PaymentRepository paymentRepository;

    private Payment seedAuthorized(UUID tripId) {
        Instant now = Instant.now();
        Payment payment = new Payment(UUID.randomUUID(), tripId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.SIMULATED_CARD, tripId.toString(), now);
        payment.markProcessing(now);
        payment.markAuthorized(now);
        return paymentRepository.save(payment);
    }

    private void publish(String body) {
        sns.publish(b -> b.topicArn(topicArn).message(body));
    }

    private static String tripCompleted(UUID eventId, UUID tripId) {
        return "{\"eventId\":\"" + eventId + "\",\"type\":\"trip.completed\",\"version\":1,"
                + "\"aggregateId\":\"" + tripId + "\",\"occurredAt\":\"2026-11-11T07:00:00Z\","
                + "\"data\":{\"tripId\":\"" + tripId + "\",\"passengerId\":\"" + UUID.randomUUID() + "\","
                + "\"status\":\"COMPLETED\",\"finalFare\":\"52000.00\"}}";
    }

    private long dlqDepth() {
        return Long.parseLong(sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                        .queueUrl(dlqUrl).attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES).build())
                .attributes().getOrDefault(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES, "0"));
    }

    @Test
    void tripCompletedOnTheTopicCapturesTheHoldAndADuplicateChangesNothing() {
        UUID tripId = UUID.randomUUID();
        seedAuthorized(tripId);
        String event = tripCompleted(UUID.randomUUID(), tripId);

        publish(event);
        await().atMost(Duration.ofSeconds(30)).untilAsserted(() ->
                assertThat(paymentRepository.findByTripId(tripId).orElseThrow().getStatus())
                        .isEqualTo(PaymentStatus.PAID));
        Payment paid = paymentRepository.findByTripId(tripId).orElseThrow();
        assertThat(paid.getAmount()).isEqualByComparingTo("52000.00");

        // The same event again (SQS is at-least-once): nothing changes.
        publish(event);
        await().during(Duration.ofSeconds(3)).atMost(Duration.ofSeconds(8)).untilAsserted(() -> {
            Payment again = paymentRepository.findByTripId(tripId).orElseThrow();
            assertThat(again.getStatus()).isEqualTo(PaymentStatus.PAID);
            assertThat(again.getAmount()).isEqualByComparingTo("52000.00");
            assertThat(again.getPaidAt()).isEqualTo(paid.getPaidAt());
        });
    }

    @Test
    void aPoisonMessageReachesTheDeadLetterQueue() {
        long before = dlqDepth();
        // "data" must be an object: this one cannot be parsed, so every delivery fails.
        publish("{\"eventId\":\"" + UUID.randomUUID() + "\",\"type\":\"trip.completed\","
                + "\"data\":\"not-an-object\"}");

        await().atMost(Duration.ofSeconds(40)).untilAsserted(() ->
                assertThat(dlqDepth()).isGreaterThan(before));
    }
}
