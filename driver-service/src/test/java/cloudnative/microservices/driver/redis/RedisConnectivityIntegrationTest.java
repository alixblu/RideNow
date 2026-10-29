package cloudnative.microservices.driver.redis;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Task B1 verification: the Redis config seam works - the app connects to Redis
 * and round-trips a key. Uses Testcontainers so it is self-contained and skipped
 * automatically when Docker is unavailable.
 *
 * The full driver-service context needs its Postgres too (JPA + Flyway), so a
 * postgres container is started alongside redis. webEnvironment = NONE so no HTTP
 * server starts; we only need the Spring context and the Redis connection
 * (auto-configured from spring.data.redis.*).
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class RedisConnectivityIntegrationTest {

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
    StringRedisTemplate redis;

    @Test
    void roundTripsAKey() {
        redis.opsForValue().set("ridenow:ping", "pong");
        assertThat(redis.opsForValue().get("ridenow:ping")).isEqualTo("pong");
    }
}
