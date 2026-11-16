package cloudnative.microservices.matching;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.matching.entity.TripOffer;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.TripOfferRepository;
import cloudnative.microservices.matching.service.DriverPositionService;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
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
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutEventsRequestEntry;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;

/**
 * Queue -> consumer -> database, end to end on LocalStack + Postgres. The bus,
 * queue, DLQ and rule are created like {@code localstack/init/01-messaging.sh}
 * (matching rule: {@code trip.requested}). Uses the Postgres finder; Redis is only
 * there because position ingest also keeps the GEO index in sync.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class MatchingQueueConsumerIntegrationTest {

    static final String BUS = "ridenow-local-events";
    static final String QUEUE = "ridenow-local-matching";
    static final String DLQ = "ridenow-local-matching-dlq";

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17").withDatabaseName("matching_service");
    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);
    @Container
    static final LocalStackContainer LOCALSTACK =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:3"));

    static SqsClient sqs;
    static EventBridgeClient eventBridge;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        REDIS.start();
        LOCALSTACK.start();
        URI endpoint = LOCALSTACK.getEndpoint();
        var creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(LOCALSTACK.getAccessKey(), LOCALSTACK.getSecretKey()));
        Region region = Region.of(LOCALSTACK.getRegion());
        sqs = SqsClient.builder().endpointOverride(endpoint).region(region).credentialsProvider(creds).build();
        eventBridge = EventBridgeClient.builder().endpointOverride(endpoint).region(region)
                .credentialsProvider(creds).build();

        eventBridge.createEventBus(b -> b.name(BUS));
        String dlqUrl = sqs.createQueue(b -> b.queueName(DLQ)).queueUrl();
        String redrive = "{\"deadLetterTargetArn\":\"" + arn(dlqUrl) + "\",\"maxReceiveCount\":\"5\"}";
        String queueUrl = sqs.createQueue(b -> b.queueName(QUEUE).attributes(Map.of(
                QueueAttributeName.REDRIVE_POLICY, redrive))).queueUrl();
        String queueArn = arn(queueUrl);
        String rule = "ridenow-local-matching-rule";
        String ruleArn = eventBridge.putRule(b -> b.name(rule).eventBusName(BUS).eventPattern(
                "{\"source\":[{\"prefix\":\"ridenow.\"}],\"detail-type\":[\"trip.requested\"]}")).ruleArn();
        String policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\","
                + "\"Principal\":{\"Service\":\"events.amazonaws.com\"},\"Action\":\"sqs:SendMessage\","
                + "\"Resource\":\"" + queueArn + "\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\""
                + ruleArn + "\"}}}]}";
        sqs.setQueueAttributes(b -> b.queueUrl(queueUrl).attributes(Map.of(QueueAttributeName.POLICY, policy)));
        eventBridge.putTargets(b -> b.rule(rule).eventBusName(BUS)
                .targets(t -> t.id("matching-queue").arn(queueArn)));

        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
        registry.add("ridenow.matching.finder", () -> "postgres");
        registry.add("ridenow.matching.queue-url", () -> queueUrl);
        registry.add("ridenow.matching.poll.wait-seconds", () -> "1");
        registry.add("ridenow.matching.poll.fixed-delay-ms", () -> "300");
        registry.add("AWS_REGION", LOCALSTACK::getRegion);
        registry.add("AWS_ENDPOINT", () -> LOCALSTACK.getEndpoint().toString());
        registry.add("AWS_ACCESS_KEY_ID", LOCALSTACK::getAccessKey);
        registry.add("AWS_SECRET_ACCESS_KEY", LOCALSTACK::getSecretKey);
    }

    @AfterAll
    static void close() {
        if (sqs != null) sqs.close();
        if (eventBridge != null) eventBridge.close();
    }

    private static String arn(String url) {
        return sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                        .queueUrl(url).attributeNames(QueueAttributeName.QUEUE_ARN).build())
                .attributes().get(QueueAttributeName.QUEUE_ARN);
    }

    @Autowired DriverPositionService positionService;
    @Autowired TripOfferRepository offerRepository;

    private void putTripRequested(String detail) {
        var response = eventBridge.putEvents(b -> b.entries(PutEventsRequestEntry.builder()
                .eventBusName(BUS).source("ridenow.trip").detailType("trip.requested").detail(detail).build()));
        assertThat(response.failedEntryCount()).isZero();
    }

    @Test
    void tripRequestedOnTheBusOffersTheNearbyDriverAndADuplicateAddsNoSecondSet() {
        UUID near = UUID.randomUUID();
        UUID far = UUID.randomUUID();
        positionService.reportPosition(near, VehicleType.CAR, new BigDecimal("10.500000"), new BigDecimal("106.500000"));
        positionService.reportPosition(far, VehicleType.CAR, new BigDecimal("10.500000"), new BigDecimal("106.700000"));
        UUID tripId = UUID.randomUUID();
        String event = "{\"eventId\":\"" + UUID.randomUUID() + "\",\"type\":\"trip.requested\",\"version\":1,"
                + "\"aggregateId\":\"" + tripId + "\",\"occurredAt\":\"2026-11-11T07:00:00Z\","
                + "\"data\":{\"tripId\":\"" + tripId + "\",\"passengerId\":\"" + UUID.randomUUID() + "\","
                + "\"status\":\"SEARCHING\",\"rideType\":\"CAR\","
                + "\"pickupLat\":\"10.500000\",\"pickupLng\":\"106.500000\","
                + "\"destinationLat\":\"10.600000\",\"destinationLng\":\"106.600000\"}}";

        putTripRequested(event);
        await().atMost(Duration.ofSeconds(30)).untilAsserted(() ->
                assertThat(offerRepository.findByTripIdOrderByOfferedAtAsc(tripId))
                        .extracting(TripOffer::getDriverId).containsExactly(near));

        // The same event again (SQS is at-least-once): no second set of offers.
        putTripRequested(event);
        await().during(Duration.ofSeconds(3)).atMost(Duration.ofSeconds(8)).untilAsserted(() ->
                assertThat(offerRepository.findByTripIdOrderByOfferedAtAsc(tripId)).hasSize(1));
    }
}
