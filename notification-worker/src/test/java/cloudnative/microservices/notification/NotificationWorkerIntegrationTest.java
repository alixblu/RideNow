package cloudnative.microservices.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.notification.repository.ProcessedNotificationRepository;
import cloudnative.microservices.notification.service.NotificationSender;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
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
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

/**
 * Task A5 + A6 verification: the worker boots with its real wiring (context
 * loads, Flyway applies), consumes an EventBridge-shaped message from SQS once,
 * ignores a duplicate delivery (idempotency), and lets a poisoned message reach
 * the dead-letter queue after the redrive maxReceiveCount.
 *
 * Skipped automatically when Docker is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class NotificationWorkerIntegrationTest {

    static final String QUEUE = "ridenow-local-notifications";
    static final String DLQ = "ridenow-local-notifications-dlq";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17").withDatabaseName("notification_service");

    @Container
    static final LocalStackContainer LOCALSTACK =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:3"));

    static SqsClient sqs;
    static String queueUrl;
    static String dlqUrl;

    // A test sender that counts "sends" and can be told to fail for a given event.
    static final SentRecorder RECORDER = new SentRecorder();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        LOCALSTACK.start();

        var creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(LOCALSTACK.getAccessKey(), LOCALSTACK.getSecretKey()));
        sqs = SqsClient.builder()
                .endpointOverride(LOCALSTACK.getEndpoint())
                .region(Region.of(LOCALSTACK.getRegion()))
                .credentialsProvider(creds)
                .build();

        // DLQ first, then the work queue with a redrive policy (maxReceiveCount 2
        // keeps the DLQ test fast), plus a short visibility timeout for quick retry.
        dlqUrl = sqs.createQueue(b -> b.queueName(DLQ)).queueUrl();
        String dlqArn = sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                        .queueUrl(dlqUrl).attributeNames(QueueAttributeName.QUEUE_ARN).build())
                .attributes().get(QueueAttributeName.QUEUE_ARN);
        String redrive = "{\"deadLetterTargetArn\":\"" + dlqArn + "\",\"maxReceiveCount\":\"2\"}";
        queueUrl = sqs.createQueue(b -> b.queueName(QUEUE).attributes(java.util.Map.of(
                QueueAttributeName.REDRIVE_POLICY, redrive,
                QueueAttributeName.VISIBILITY_TIMEOUT, "1"))).queueUrl();

        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("ridenow.notifications.queue-url", () -> queueUrl);
        registry.add("ridenow.notifications.poll.wait-seconds", () -> "1");
        registry.add("ridenow.notifications.poll.fixed-delay-ms", () -> "300");
        registry.add("AWS_REGION", LOCALSTACK::getRegion);
        registry.add("AWS_ENDPOINT", () -> LOCALSTACK.getEndpoint().toString());
        registry.add("AWS_ACCESS_KEY_ID", LOCALSTACK::getAccessKey);
        registry.add("AWS_SECRET_ACCESS_KEY", LOCALSTACK::getSecretKey);
    }

    @Autowired
    ProcessedNotificationRepository processedRepository;

    /** Build an EventBridge-shaped message wrapping a DomainEvent under "detail". */
    private static String eventBridgeMessage(UUID eventId, String type, UUID aggregateId) {
        return "{\"source\":\"ridenow.trip\",\"detail-type\":\"" + type + "\",\"detail\":{"
                + "\"eventId\":\"" + eventId + "\",\"type\":\"" + type + "\","
                + "\"aggregateId\":\"" + aggregateId + "\",\"data\":{\"tripId\":\"" + aggregateId + "\"}}}";
    }

    private void send(String body) {
        sqs.sendMessage(SendMessageRequest.builder().queueUrl(queueUrl).messageBody(body).build());
    }

    @Test
    void processesEventOnceAndIsIdempotentOnDuplicate() {
        UUID eventId = UUID.randomUUID();
        UUID tripId = UUID.randomUUID();
        String body = eventBridgeMessage(eventId, "trip.completed", tripId);

        // Deliver the same event twice.
        send(body);
        send(body);

        await().atMost(Duration.ofSeconds(30)).untilAsserted(() ->
                assertThat(processedRepository.existsById(eventId)).isTrue());

        // Idempotency: recorded once, sent once, despite two deliveries.
        await().during(Duration.ofSeconds(3)).atMost(Duration.ofSeconds(8)).untilAsserted(() ->
                assertThat(RECORDER.count(tripId)).isEqualTo(1));
    }

    @Test
    void poisonedMessageReachesDeadLetterQueue() {
        UUID eventId = UUID.randomUUID();
        UUID tripId = UUID.randomUUID();
        RECORDER.failFor(tripId);
        send(eventBridgeMessage(eventId, "trip.completed", tripId));

        // After maxReceiveCount (2) failed deliveries the message lands in the DLQ.
        await().atMost(Duration.ofSeconds(40)).untilAsserted(() -> {
            long dlqDepth = Long.parseLong(sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                            .queueUrl(dlqUrl)
                            .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                            .build())
                    .attributes().getOrDefault(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES, "0"));
            assertThat(dlqDepth).isGreaterThanOrEqualTo(1);
        });
        assertThat(processedRepository.existsById(eventId)).isFalse();
    }

    @TestConfiguration
    static class TestSenderConfig {
        @Bean
        @Primary
        NotificationSender recordingSender() {
            return RECORDER;
        }
    }

    /** Records sends per event id and can be told to throw for a given event. */
    static class SentRecorder implements NotificationSender {
        private final java.util.Map<String, Integer> counts = new ConcurrentHashMap<>();
        private final java.util.Set<String> failing = ConcurrentHashMap.newKeySet();

        void failFor(UUID aggregateId) {
            failing.add(aggregateId.toString());
        }

        int count(UUID aggregateId) {
            return counts.getOrDefault(aggregateId.toString(), 0);
        }

        @Override
        public void send(String eventType, String aggregateId, String summary) {
            // The consumer passes the aggregate id; we key both the failure switch
            // and the send counter on it, so each test's distinct aggregate stays
            // isolated.
            if (failing.contains(aggregateId)) {
                throw new IllegalStateException("simulated send failure");
            }
            counts.merge(aggregateId, 1, Integer::sum);
        }
    }
}
