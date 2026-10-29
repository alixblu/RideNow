package cloudnative.microservices.driver.cache;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.entity.DriverStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Task B5 verification against real Redis: a stored profile is read back (cache
 * hit) and an evict removes it (next read is a miss). Proves the cache-aside
 * store round-trips and invalidates. Skipped when Docker is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class DriverProfileCacheIntegrationTest {

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
    DriverProfileCache cache;

    @Test
    void putThenGetReturnsProfileAndEvictRemovesIt() {
        UUID id = UUID.randomUUID();
        DriverResponse profile = new DriverResponse(id, UUID.randomUUID(), "LIC-1",
                DriverStatus.ACTIVE, new BigDecimal("4.80"), 12L, Instant.now(), Instant.now());

        assertThat(cache.get(id)).isEmpty();          // initial miss

        cache.put(profile);
        assertThat(cache.get(id)).isPresent()         // hit, same data
                .get().extracting(DriverResponse::licenseNumber).isEqualTo("LIC-1");

        cache.evict(id);
        assertThat(cache.get(id)).isEmpty();          // miss after evict
    }
}
