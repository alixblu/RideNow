package cloudnative.microservices.trip.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.Trip;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
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
import software.amazon.awssdk.services.eventbridge.EventBridgeClient;
import software.amazon.awssdk.services.eventbridge.model.PutRuleRequest;
import software.amazon.awssdk.services.eventbridge.model.PutTargetsRequest;
import software.amazon.awssdk.services.eventbridge.model.Target;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.CreateQueueResponse;
import software.amazon.awssdk.services.sqs.model.GetQueueAttributesRequest;
import software.amazon.awssdk.services.sqs.model.Message;
import software.amazon.awssdk.services.sqs.model.QueueAttributeName;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.SetQueueAttributesRequest;
import tools.jackson.databind.ObjectMapper;

/**
 * Task A4 verification: a DomainEvent published through
 * {@link EventBridgeDomainEventPublisher} to the EventBridge bus is routed by the
 * rule to the SQS notifications queue - proving the real publish path end to end
 * against LocalStack (no mocks).
 *
 * The test provisions the same footprint the compose init script creates (bus,
 * queue, rule, queue policy) so it is self-contained. It is skipped automatically
 * when Docker is not available.
 */
@Testcontainers
class EventBridgeToSqsIntegrationTest {

    private static final String BUS = "ridenow-local-events";
    private static final String QUEUE = "ridenow-local-notifications";
    private static final String RULE = "ridenow-local-all-events";

    @Container
    static final LocalStackContainer LOCALSTACK =
            new LocalStackContainer(DockerImageName.parse("localstack/localstack:3"));

    static SqsClient sqs;
    static EventBridgeClient eventBridge;
    static String queueUrl;

    @BeforeAll
    static void provision() {
        URI endpoint = LOCALSTACK.getEndpoint();
        var creds = StaticCredentialsProvider.create(
                AwsBasicCredentials.create(LOCALSTACK.getAccessKey(), LOCALSTACK.getSecretKey()));
        Region region = Region.of(LOCALSTACK.getRegion());

        sqs = SqsClient.builder().endpointOverride(endpoint).region(region).credentialsProvider(creds).build();
        eventBridge = EventBridgeClient.builder().endpointOverride(endpoint).region(region).credentialsProvider(creds).build();

        eventBridge.createEventBus(b -> b.name(BUS));

        CreateQueueResponse queue = sqs.createQueue(b -> b.queueName(QUEUE));
        queueUrl = queue.queueUrl();
        String queueArn = sqs.getQueueAttributes(GetQueueAttributesRequest.builder()
                        .queueUrl(queueUrl)
                        .attributeNames(QueueAttributeName.QUEUE_ARN)
                        .build())
                .attributes().get(QueueAttributeName.QUEUE_ARN);

        // Allow EventBridge to deliver to the queue.
        String policy = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\","
                + "\"Principal\":{\"Service\":\"events.amazonaws.com\"},\"Action\":\"sqs:SendMessage\","
                + "\"Resource\":\"" + queueArn + "\"}]}";
        sqs.setQueueAttributes(SetQueueAttributesRequest.builder()
                .queueUrl(queueUrl)
                .attributes(java.util.Map.of(QueueAttributeName.POLICY, policy))
                .build());

        eventBridge.putRule(PutRuleRequest.builder()
                .name(RULE)
                .eventBusName(BUS)
                .eventPattern("{\"source\":[{\"prefix\":\"ridenow.\"}]}")
                .build());
        eventBridge.putTargets(PutTargetsRequest.builder()
                .rule(RULE)
                .eventBusName(BUS)
                .targets(Target.builder().id("notifications-queue").arn(queueArn).build())
                .build());
    }

    @AfterAll
    static void close() {
        if (sqs != null) sqs.close();
        if (eventBridge != null) eventBridge.close();
    }

    @Test
    void publishedTripCompletedEventIsRoutedToSqsQueue() {
        DomainEventPublisher publisher =
                new EventBridgeDomainEventPublisher(eventBridge, new ObjectMapper(), BUS);

        Trip trip = new Trip(UUID.randomUUID(), UUID.randomUUID(), RideType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"),
                new BigDecimal("10.100000"), new BigDecimal("106.100000"), Instant.now());
        DomainEvent event = TripEvents.tripCompleted(trip);

        publisher.publish(event);

        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            List<Message> messages = sqs.receiveMessage(ReceiveMessageRequest.builder()
                    .queueUrl(queueUrl)
                    .maxNumberOfMessages(10)
                    .waitTimeSeconds(2)
                    .build()).messages();
            assertThat(messages).isNotEmpty();
            // EventBridge wraps the event; the detail-type and our event type appear in the body.
            assertThat(messages).anyMatch(m -> m.body().contains(TripEvents.TRIP_COMPLETED));
        });
    }
}
