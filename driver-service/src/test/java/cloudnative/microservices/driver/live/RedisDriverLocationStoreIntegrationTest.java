package cloudnative.microservices.driver.live;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
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
 * Task B2 verification: the Redis-backed live-state store sets ONLINE, records a
 * position, reads it back, expires on a TTL, and clears on OFFLINE. Runs against
 * real Redis (Testcontainers); skipped when Docker is unavailable.
 */
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class RedisDriverLocationStoreIntegrationTest {

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
    DriverLocationStore store;

    @Autowired
    StringRedisTemplate redis;

    @Test
    void onlineThenLocationIsReadableThenOfflineClears() {
        UUID driverId = UUID.randomUUID();

        store.goOnline(driverId);
        assertThat(store.getState(driverId)).isPresent()
                .get().extracting(DriverLiveState::availability).isEqualTo(Availability.ONLINE);

        store.updateLocation(driverId, new BigDecimal("10.762622"), new BigDecimal("106.660172"));
        Optional<DriverLiveState> withLoc = store.getState(driverId);
        assertThat(withLoc).isPresent();
        assertThat(withLoc.get().lat()).isEqualByComparingTo("10.762622");
        assertThat(withLoc.get().lng()).isEqualByComparingTo("106.660172");

        store.goOffline(driverId);
        assertThat(store.getState(driverId)).isEmpty();
    }

    @Test
    void liveRecordHasATtl() {
        UUID driverId = UUID.randomUUID();
        store.goOnline(driverId);

        Long ttl = redis.getExpire("ridenow:driver:live:" + driverId, TimeUnit.SECONDS);
        assertThat(ttl).isNotNull().isGreaterThan(0L);
    }
}
