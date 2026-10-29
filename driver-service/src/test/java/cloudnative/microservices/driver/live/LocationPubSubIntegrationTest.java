package cloudnative.microservices.driver.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Task B6 verification: a location update published on the Redis Pub/Sub channel
 * is received by a subscriber. Proves the backend side of live tracking end to
 * end against real Redis. Skipped when Docker is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class LocationPubSubIntegrationTest {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:17").withDatabaseName("driver_service");

    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        REDIS.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.host", REDIS::getHost);
        registry.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379));
    }

    @Autowired
    LocationPublisher publisher;

    @Autowired
    RedisConnectionFactory connectionFactory;

    @Test
    void publishedLocationUpdateIsReceivedBySubscriber() {
        List<String> received = new CopyOnWriteArrayList<>();

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        MessageListener listener = (message, pattern) ->
                received.add(new String(message.getBody()));
        container.addMessageListener(listener, new ChannelTopic(LocationPublisher.CHANNEL));
        container.afterPropertiesSet();
        container.start();
        try {
            // Give the subscription a moment to register before publishing.
            await().atMost(Duration.ofSeconds(5)).until(container::isRunning);

            UUID driverId = UUID.randomUUID();
            await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> {
                publisher.publish(driverId, new BigDecimal("10.5"), new BigDecimal("106.5"));
                assertThat(received).anyMatch(m -> m.contains(driverId.toString()));
            });
        } finally {
            container.stop();
        }
    }
}
