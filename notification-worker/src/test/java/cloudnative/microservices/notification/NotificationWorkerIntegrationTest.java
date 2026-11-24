package cloudnative.microservices.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.notification.dto.NotificationResponse;
import cloudnative.microservices.notification.repository.NotificationRepository;
import cloudnative.microservices.notification.repository.ProcessedNotificationRepository;
import cloudnative.microservices.notification.service.InboxNotificationSender;
import cloudnative.microservices.notification.service.NotificationInboxService;
import cloudnative.microservices.notification.service.NotificationSender;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
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
 * The worker boots with its real wiring (context loads, Flyway applies), consumes
 * a raw-delivery event message from SQS once, writes one inbox row, ignores a
 * duplicate delivery (idempotency), and lets a poisoned message reach the
 * dead-letter queue after the redrive maxReceiveCount, leaving no ledger or inbox row.
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

    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);
    static SqsClient sqs;
    static String queueUrl;
    static String dlqUrl;

    // A test sender that counts "sends" and can be told to fail for a given event.
    static final SentRecorder RECORDER = new SentRecorder();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        LOCALSTACK.start();
        REDIS.start();

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
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
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
    @Autowired
    NotificationRepository notificationRepository;
    @Autowired
    NotificationInboxService inboxService;
    @Autowired
    StringRedisTemplate redis;

    /** Build a raw-delivery message body: the DomainEvent JSON itself. */
    private static String eventMessage(UUID eventId, String type, UUID aggregateId, UUID passengerId) {
        return eventMessage(eventId, type, aggregateId, passengerId, null);
    }
    private static String eventMessage(
            UUID eventId, String type, UUID aggregateId, UUID passengerId, UUID driverId) {
        return "{"
                + "\"eventId\":\"" + eventId + "\",\"type\":\"" + type + "\","
                + "\"aggregateId\":\"" + aggregateId + "\",\"data\":{\"tripId\":\"" + aggregateId + "\","
                + "\"passengerId\":\"" + passengerId + "\""
                + (driverId == null ? "" : ",\"driverId\":\"" + driverId + "\"") + "}}";
    }

    private void send(String body) {
        sqs.sendMessage(SendMessageRequest.builder().queueUrl(queueUrl).messageBody(body).build());
    }

    @Test
    void processesEventOnceAndIsIdempotentOnDuplicate() {
        UUID eventId = UUID.randomUUID();
        UUID tripId = UUID.randomUUID();
        UUID passengerId = UUID.randomUUID();
        String body = eventMessage(eventId, "trip.completed", tripId, passengerId);

        // Deliver the same event twice.
        send(body);
        send(body);

        await().atMost(Duration.ofSeconds(30)).untilAsserted(() ->
                assertThat(processedRepository.existsById(eventId)).isTrue());

        // Idempotency: recorded once, sent once, despite two deliveries.
        await().during(Duration.ofSeconds(3)).atMost(Duration.ofSeconds(8)).untilAsserted(() ->
                assertThat(RECORDER.count(tripId)).isEqualTo(1));
        // The inbox has exactly one row for the passenger, readable through the service.
        List<NotificationResponse> inbox = inboxService.list(passengerId, null, 50);
        assertThat(inbox).hasSize(1);
        assertThat(inbox.getFirst().type()).isEqualTo("trip.completed");
        assertThat(inbox.getFirst().tripId()).isEqualTo(tripId);
        assertThat(inbox.getFirst().readAt()).isNull();
        assertThat(inboxService.list(passengerId, inbox.getFirst().id(), 50)).isEmpty();
    }

    /** driver.accepted pairs passenger and driver in Redis; trip.completed removes the pairing. */
    @Test
    void trackingKeysAppearOnAcceptAndDisappearOnCompletion() {
        UUID tripId = UUID.randomUUID();
        UUID passengerId = UUID.randomUUID();
        UUID driverId = UUID.randomUUID();
        String tripKey = "ridenow:tracking:trip:" + tripId;
        String driverKey = "ridenow:tracking:driver:" + driverId;

        send(eventMessage(UUID.randomUUID(), "driver.accepted", tripId, passengerId, driverId));
        await().atMost(Duration.ofSeconds(30)).untilAsserted(() -> {
            assertThat(redis.opsForValue().get(tripKey)).contains(passengerId.toString(), driverId.toString());
            assertThat(redis.opsForValue().get(driverKey)).contains(tripId.toString());
            assertThat(redis.getExpire(tripKey)).isBetween(1L, 3L * 60 * 60);
        });

        send(eventMessage(UUID.randomUUID(), "trip.completed", tripId, passengerId, driverId));
        await().atMost(Duration.ofSeconds(30)).untilAsserted(() -> {
            assertThat(redis.hasKey(tripKey)).isFalse();
            assertThat(redis.hasKey(driverKey)).isFalse();
        });
    }
    @Test
    void poisonedMessageReachesDeadLetterQueue() {
        UUID eventId = UUID.randomUUID();
        UUID tripId = UUID.randomUUID();
        UUID passengerId = UUID.randomUUID();
        RECORDER.failFor(tripId);
        send(eventMessage(eventId, "trip.completed", tripId, passengerId));

        // After maxReceiveCount (2) failed deliveries the message lands in the DLQ.
        await().atMost(Duration.ofSeconds(40)).untilAsserted(() -> {
            long dlqDepth = Long.parseLong(sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                            .queueUrl(dlqUrl)
                            .attributeNames(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES)
                            .build())
                    .attributes().getOrDefault(QueueAttributeName.APPROXIMATE_NUMBER_OF_MESSAGES, "0"));
            assertThat(dlqDepth).isGreaterThanOrEqualTo(1);
        });
        // The failed event left nothing behind: no ledger row and no inbox row.
        assertThat(processedRepository.existsById(eventId)).isFalse();
        assertThat(notificationRepository.findByUserIdOrderByCreatedAtDescIdDesc(
                passengerId, org.springframework.data.domain.PageRequest.ofSize(10))).isEmpty();
    }

    @TestConfiguration
    static class TestSenderConfig {
        @Bean
        @Primary
        NotificationSender recordingSender(NotificationRepository repository) {
            // Wraps the real inbox sender: the recorder counts and can inject a failure,
            // everything else is the production path.
            RECORDER.delegate = new InboxNotificationSender(repository);
            return RECORDER;
        }
    }

    /** Records sends per event id and can be told to throw for a given event. */
    static class SentRecorder implements NotificationSender {
        InboxNotificationSender delegate;
        private final java.util.Map<String, Integer> counts = new ConcurrentHashMap<>();
        private final java.util.Set<String> failing = ConcurrentHashMap.newKeySet();

        void failFor(UUID aggregateId) {
            failing.add(aggregateId.toString());
        }

        int count(UUID aggregateId) {
            return counts.getOrDefault(aggregateId.toString(), 0);
        }

        @Override
        public void send(cloudnative.microservices.notification.dto.NotificationMessage notification) {
            // Each test uses a distinct trip id; we key both the failure switch and
            // the send counter on it, so the tests stay isolated.
            String tripId = notification.tripId();
            // Write the real inbox row first, then fail: the surrounding transaction
            // must roll the row back, along with the ledger entry.
            delegate.send(notification);
            if (failing.contains(tripId)) {
                throw new IllegalStateException("simulated send failure");
            }
            counts.merge(tripId, 1, Integer::sum);
        }
    }
}
