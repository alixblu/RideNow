package cloudnative.microservices.matching.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import cloudnative.microservices.matching.event.DriverLocationStreamConsumer.Settings;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStreamCommands.XAddOptions;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Drives {@link DriverLocationStreamConsumer} step by step against a real Valkey:
 * delivery after downtime, retry on failure, takeover from a dead pod, and the
 * dead-letter stream. Each test uses its own stream, so they do not affect each other.
 * Skipped when Docker is unavailable.
 */
@Testcontainers
class DriverLocationStreamConsumerIntegrationTest {

    private static final Duration IDLE = Duration.ofMillis(20);

    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("valkey/valkey:8-alpine")).withExposedPorts(6379);

    static LettuceConnectionFactory connectionFactory;
    static StringRedisTemplate redis;

    DriverLocationSubscriber subscriber;
    String stream;
    String dlq;

    @BeforeAll
    static void connect() {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        redis = new StringRedisTemplate(connectionFactory);
        redis.afterPropertiesSet();
    }

    @AfterAll
    static void disconnect() {
        connectionFactory.destroy();
    }

    @BeforeEach
    void freshStream() {
        subscriber = mock(DriverLocationSubscriber.class);
        stream = "test:locations:" + UUID.randomUUID();
        dlq = stream + ":dlq";
    }

    private DriverLocationStreamConsumer consumer(String name, int maxDeliveries) {
        return new DriverLocationStreamConsumer(redis, subscriber, new Settings(
                stream, "matching", name, 100, Duration.ofMillis(200), IDLE, Duration.ofSeconds(30),
                maxDeliveries, dlq, 1000));
    }

    private void add(String payload) {
        redis.opsForStream().add(StreamRecords.string(Map.of("payload", payload)).withStreamKey(stream),
                XAddOptions.maxlen(10_000).approximateTrimming(true));
    }

    private long pendingCount() {
        return redis.opsForStream().pending(stream, "matching").getTotalPendingMessages();
    }

    private static void pause() throws InterruptedException {
        Thread.sleep(IDLE.toMillis() * 3);
    }

    @Test
    void creatingTheGroupTwiceIsHarmless() {
        DriverLocationStreamConsumer consumer = consumer("pod-a", 5);

        consumer.ensureGroup();

        assertThatCode(consumer::ensureGroup).doesNotThrowAnyException();
    }

    @Test
    void entriesAddedWhileNoPodWasReadingAreDeliveredAndAcknowledgedLater() {
        DriverLocationStreamConsumer consumer = consumer("pod-a", 5);
        consumer.ensureGroup();

        // matching is "down": nothing reads while these arrive
        add("one");
        add("two");
        add("three");
        assertThat(consumer.pollOnce()).isEqualTo(3);

        verify(subscriber).onMessage("one");
        verify(subscriber).onMessage("two");
        verify(subscriber).onMessage("three");
        assertThat(pendingCount()).isZero();
    }

    @Test
    void anEntryWhoseHandlerFailedStaysPendingAndIsRetriedUntilItSucceeds() throws Exception {
        DriverLocationStreamConsumer consumer = consumer("pod-a", 5);
        consumer.ensureGroup();
        add("flaky");
        doThrow(new IllegalStateException("db down")).doThrow(new IllegalStateException("db down"))
                .doNothing().when(subscriber).onMessage("flaky");

        consumer.pollOnce();                       // delivery 1: fails
        assertThat(pendingCount()).isEqualTo(1);
        pause();
        assertThat(consumer.reclaimOnce()).isEqualTo(1);   // delivery 2: fails
        assertThat(pendingCount()).isEqualTo(1);
        pause();
        assertThat(consumer.reclaimOnce()).isEqualTo(1);   // delivery 3: succeeds

        verify(subscriber, times(3)).onMessage("flaky");
        assertThat(pendingCount()).isZero();
        assertThat(redis.opsForStream().size(dlq)).isZero();
    }

    @Test
    void anotherPodTakesOverEntriesAPodDiedHolding() throws Exception {
        DriverLocationStreamConsumer dying = consumer("pod-dies", 5);
        dying.ensureGroup();
        add("half-done");
        doThrow(new IllegalStateException("killed mid-batch")).when(subscriber).onMessage("half-done");
        dying.pollOnce();                          // pod-dies reads it and never acknowledges
        assertThat(pendingCount()).isEqualTo(1);

        org.mockito.Mockito.reset(subscriber);     // the surviving pod handles it fine
        pause();
        DriverLocationStreamConsumer survivor = consumer("pod-lives", 5);
        survivor.ensureGroup();

        assertThat(survivor.reclaimOnce()).isEqualTo(1);

        verify(subscriber).onMessage("half-done");
        assertThat(pendingCount()).isZero();
    }

    @Test
    void anEntryThatKeepsFailingEndsUpInTheDeadLetterStream() throws Exception {
        DriverLocationStreamConsumer consumer = consumer("pod-a", 3);
        consumer.ensureGroup();
        add("poison");
        doThrow(new IllegalStateException("always fails")).when(subscriber).onMessage("poison");

        consumer.pollOnce();                       // delivery 1
        pause();
        consumer.reclaimOnce();                    // delivery 2
        pause();
        consumer.reclaimOnce();                    // delivery 3
        pause();
        consumer.reclaimOnce();                    // out of deliveries: dead-lettered

        verify(subscriber, times(3)).onMessage("poison");
        assertThat(pendingCount()).isZero();
        List<MapRecord<String, Object, Object>> dead = redis.opsForStream().range(dlq, Range.unbounded());
        assertThat(dead).hasSize(1);
        assertThat(dead.get(0).getValue()).containsEntry("payload", "poison")
                .containsKeys("originalId", "deliveries");
        assertThat(dead.get(0).getValue().get("deliveries")).isEqualTo("3");
    }

    @Test
    void anEntryWithNoPayloadIsAcknowledgedAndSkipped() {
        DriverLocationStreamConsumer consumer = consumer("pod-a", 5);
        consumer.ensureGroup();
        redis.opsForStream().add(StreamRecords.string(Map.of("other", "x")).withStreamKey(stream));

        consumer.pollOnce();

        verify(subscriber, never()).onMessage(anyString());
        assertThat(pendingCount()).isZero();
    }

    @Test
    void eachEntryGoesToExactlyOnePodOfTheGroup() {
        DriverLocationStreamConsumer podA = consumer("pod-a", 5);
        DriverLocationStreamConsumer podB = consumer("pod-b", 5);
        podA.ensureGroup();
        for (int i = 0; i < 20; i++) {
            add("m" + i);
        }

        int total = podA.pollOnce() + podB.pollOnce();

        assertThat(total).isEqualTo(20);
        verify(subscriber, times(20)).onMessage(anyString());
    }

    @Test
    void entriesWrittenBeforeTheGroupExistedAreStillDelivered() {
        // driver-service is deployed first and has been writing; matching starts later
        add("early-1");
        add("early-2");
        DriverLocationStreamConsumer consumer = consumer("pod-a", 5);

        consumer.ensureGroup();

        assertThat(consumer.pollOnce()).isEqualTo(2);
        verify(subscriber).onMessage("early-1");
        verify(subscriber).onMessage("early-2");
        assertThat(pendingCount()).isZero();
    }
}
