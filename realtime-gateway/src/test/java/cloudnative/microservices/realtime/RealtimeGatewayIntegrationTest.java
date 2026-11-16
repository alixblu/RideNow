package cloudnative.microservices.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import cloudnative.microservices.realtime.dto.Pairing;
import cloudnative.microservices.realtime.service.LocationRelay;
import cloudnative.microservices.realtime.service.PairingStore;
import cloudnative.microservices.realtime.service.StreamRegistry;
import cloudnative.microservices.realtime.service.TripEndedRelay;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;

/**
 * End-to-end through the real HTTP/SSE stack on a random port, with a real HTTP
 * client. Redis is switched off: the tests call {@link LocationRelay#onMessage} and
 * {@link TripEndedRelay#onMessage} - the exact methods the Redis listeners call - and
 * an in-memory {@link PairingStore} stands in for the keys notification-worker writes.
 */
@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "ridenow.gateway.redis.enabled=false",
                "ridenow.gateway.heartbeat-millis=300"
        })
class RealtimeGatewayIntegrationTest {

    private static final String END = "<end-of-stream>";

    @LocalServerPort private int port;
    @Autowired private LocationRelay locationRelay;
    @Autowired private TripEndedRelay tripEndedRelay;
    @Autowired private StreamRegistry registry;
    @Autowired private InMemoryPairingStore pairings;

    private final HttpClient http = HttpClient.newHttpClient();
    private final List<Thread> readers = new java.util.concurrent.CopyOnWriteArrayList<>();

    private final UUID tripId = UUID.randomUUID();
    private final UUID passengerId = UUID.randomUUID();
    private final UUID driverId = UUID.randomUUID();

    @TestConfiguration
    static class Config {
        @Bean
        InMemoryPairingStore pairingStore() {
            return new InMemoryPairingStore();
        }
    }

    static class InMemoryPairingStore implements PairingStore {
        private final Map<UUID, Pairing> byTrip = new ConcurrentHashMap<>();
        private final Map<UUID, Pairing> byDriver = new ConcurrentHashMap<>();

        void pair(Pairing p) {
            byTrip.put(p.tripId(), p);
            byDriver.put(p.driverId(), p);
        }

        void unpair(Pairing p) {
            byTrip.remove(p.tripId());
            byDriver.remove(p.driverId());
        }

        @Override
        public Optional<Pairing> findByTrip(UUID tripId) {
            return Optional.ofNullable(byTrip.get(tripId));
        }

        @Override
        public Optional<Pairing> findByDriver(UUID driverId) {
            return Optional.ofNullable(byDriver.get(driverId));
        }
    }

    /** An open stream: every line the server sends lands in {@link #lines}; the end is marked. */
    private static final class Stream {
        final int status;
        final HttpResponse<java.util.stream.Stream<String>> response;
        final BlockingQueue<String> lines = new LinkedBlockingQueue<>();

        Stream(HttpResponse<java.util.stream.Stream<String>> response) {
            this.response = response;
            this.status = response.statusCode();
        }

        String await(java.util.function.Predicate<String> match, Duration timeout) throws InterruptedException {
            long deadline = System.nanoTime() + timeout.toNanos();
            while (System.nanoTime() < deadline) {
                String line = lines.poll(100, TimeUnit.MILLISECONDS);
                if (line != null && match.test(line)) {
                    return line;
                }
            }
            return null;
        }

        long count(java.util.function.Predicate<String> match) {
            return lines.stream().filter(match).count();
        }
    }

    private URI uri(UUID trip, String userId) {
        return URI.create("http://localhost:" + port + "/live/trips/" + trip + "/location?userId=" + userId);
    }

    private Stream open(UUID trip, String userId) throws Exception {
        HttpResponse<java.util.stream.Stream<String>> response = http.send(
                HttpRequest.newBuilder(uri(trip, userId)).header("Accept", "text/event-stream").build(),
                HttpResponse.BodyHandlers.ofLines());
        Stream stream = new Stream(response);
        if (stream.status == 200) {
            Thread reader = new Thread(() -> {
                try {
                    response.body().forEach(stream.lines::add);
                } catch (RuntimeException ignored) {
                    // the connection was closed under us
                } finally {
                    stream.lines.add(END);
                }
            }, "sse-test-reader");
            reader.setDaemon(true);
            reader.start();
            readers.add(reader);
        }
        return stream;
    }

    private Pairing pairTrip() {
        Pairing pairing = new Pairing(tripId, passengerId, driverId);
        pairings.pair(pairing);
        return pairing;
    }

    private String position(UUID driver, String lat, String lng) {
        return "{\"driverId\":\"" + driver + "\",\"lat\":" + lat + ",\"lng\":" + lng
                + ",\"recordedAt\":\"2026-11-11T07:00:00Z\",\"vehicleType\":\"CAR\",\"online\":true}";
    }

    @AfterEach
    void cleanUp() {
        registry.closeAll();
    }

    @Test
    void thePairedPassengerGetsLocationEventsWithNoIdAndStreamHeaders() throws Exception {
        pairTrip();
        Stream stream = open(tripId, passengerId.toString());

        assertThat(stream.status).isEqualTo(200);
        assertThat(stream.response.headers().firstValue("Content-Type").orElse("")).startsWith("text/event-stream");
        assertThat(stream.response.headers().firstValue("Cache-Control")).contains("no-cache");
        assertThat(stream.response.headers().firstValue("X-Accel-Buffering")).contains("no");
        assertThat(stream.await(l -> l.startsWith("retry:"), Duration.ofSeconds(5))).isNotNull();

        locationRelay.onMessage(position(driverId, "10.7769", "106.7009"));

        assertThat(stream.await(l -> l.equals("event:location"), Duration.ofSeconds(5))).isNotNull();
        String data = stream.await(l -> l.startsWith("data:"), Duration.ofSeconds(5));
        assertThat(data).contains("\"driverId\":\"" + driverId + "\"")
                .contains("\"tripId\":\"" + tripId + "\"")
                .contains("\"lat\":10.7769")
                .contains("\"lng\":106.7009")
                .contains("\"recordedAt\":\"2026-11-11T07:00:00Z\"")
                .doesNotContain("vehicleType");
        assertThat(stream.count(l -> l.startsWith("id:"))).isZero();
    }

    @Test
    void anUnpairedDriversPositionsAreDropped() throws Exception {
        pairTrip();
        Stream stream = open(tripId, passengerId.toString());
        assertThat(stream.await(l -> l.startsWith("retry:"), Duration.ofSeconds(5))).isNotNull();

        locationRelay.onMessage(position(UUID.randomUUID(), "1.0", "2.0"));

        assertThat(stream.await(l -> l.equals("event:location"), Duration.ofMillis(700))).isNull();
        // the paired driver still gets through afterwards
        locationRelay.onMessage(position(driverId, "10.0", "106.0"));
        assertThat(stream.await(l -> l.equals("event:location"), Duration.ofSeconds(5))).isNotNull();
    }

    @Test
    void anOfflineMarkerAndMalformedMessagesAreDropped() throws Exception {
        pairTrip();
        Stream stream = open(tripId, passengerId.toString());
        assertThat(stream.await(l -> l.startsWith("retry:"), Duration.ofSeconds(5))).isNotNull();

        locationRelay.onMessage("{\"driverId\":\"" + driverId + "\",\"online\":false}");
        locationRelay.onMessage("not json");
        locationRelay.onMessage("{\"driverId\":\"" + driverId + "\"}");

        assertThat(stream.await(l -> l.equals("event:location"), Duration.ofMillis(700))).isNull();
    }

    @Test
    void anotherUserIsForbiddenAndAnUnknownTripIsGone() throws Exception {
        pairTrip();

        assertThat(open(tripId, UUID.randomUUID().toString()).status).isEqualTo(403);
        assertThat(open(UUID.randomUUID(), passengerId.toString()).status).isEqualTo(410);
        assertThat(registry.totalStreams()).isZero();
    }

    @Test
    void aBadUuidIs400() throws Exception {
        pairTrip();

        assertThat(open(tripId, "not-a-uuid").status).isEqualTo(400);
        HttpResponse<String> badTrip = http.send(HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + "/live/trips/nope/location?userId=" + passengerId)).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(badTrip.statusCode()).isEqualTo(400);
    }

    @Test
    void tripEndedSendsTheEventClosesTheStreamAndAReconnectIsGone() throws Exception {
        Pairing pairing = pairTrip();
        Stream stream = open(tripId, passengerId.toString());
        assertThat(stream.await(l -> l.startsWith("retry:"), Duration.ofSeconds(5))).isNotNull();

        // what notification-worker does: delete the keys, then publish the end
        pairings.unpair(pairing);
        tripEndedRelay.onMessage("{\"tripId\":\"" + tripId + "\"}");

        assertThat(stream.await(l -> l.equals("event:trip-ended"), Duration.ofSeconds(5))).isNotNull();
        assertThat(stream.await(l -> l.equals(END), Duration.ofSeconds(5))).isEqualTo(END);
        assertThat(registry.streamCount(tripId)).isZero();
        assertThat(open(tripId, passengerId.toString()).status).isEqualTo(410);
    }

    @Test
    void locationEventsAreThrottledToOnePerSecondPerTrip() throws Exception {
        pairTrip();
        Stream stream = open(tripId, passengerId.toString());
        assertThat(stream.await(l -> l.startsWith("retry:"), Duration.ofSeconds(5))).isNotNull();

        for (int i = 0; i < 5; i++) {
            locationRelay.onMessage(position(driverId, "10." + i, "106.0"));
        }
        await().atMost(Duration.ofSeconds(5)).until(() -> stream.count(l -> l.equals("event:location")) >= 1);
        Thread.sleep(300);
        assertThat(stream.count(l -> l.equals("event:location"))).isEqualTo(1);

        // after the interval the next position goes through
        Thread.sleep(1_000);
        locationRelay.onMessage(position(driverId, "11.0", "106.0"));
        await().atMost(Duration.ofSeconds(5)).until(() -> stream.count(l -> l.equals("event:location")) == 2);
    }

    @Test
    void aHeartbeatCommentIsSentPeriodically() throws Exception {
        pairTrip();
        Stream stream = open(tripId, passengerId.toString());

        // ":connected" is the first comment; a ":ping" follows from the scheduler
        assertThat(stream.await(l -> l.startsWith(":") && l.contains("ping"), Duration.ofSeconds(5))).isNotNull();
    }

    @Test
    void aFourthStreamForATripEvictsTheOldest() throws Exception {
        pairTrip();
        Stream first = open(tripId, passengerId.toString());
        open(tripId, passengerId.toString());
        open(tripId, passengerId.toString());
        assertThat(registry.streamCount(tripId)).isEqualTo(3);

        open(tripId, passengerId.toString());

        await().atMost(Duration.ofSeconds(5)).until(() -> registry.streamCount(tripId) == 3);
        assertThat(first.await(l -> l.equals(END), Duration.ofSeconds(5))).isEqualTo(END);
    }

    @Test
    void shutdownCompletesEveryOpenStream() throws Exception {
        pairTrip();
        Stream stream = open(tripId, passengerId.toString());
        assertThat(stream.await(l -> l.startsWith("retry:"), Duration.ofSeconds(5))).isNotNull();

        int closed = registry.closeAll();

        assertThat(closed).isGreaterThanOrEqualTo(1);
        assertThat(stream.await(l -> l.equals(END), Duration.ofSeconds(5))).isEqualTo(END);
        assertThat(registry.totalStreams()).isZero();
    }

    @Test
    void livenessIsUpEvenWithoutRedisButReadinessReflectsRedis() throws Exception {
        var base = "http://localhost:" + port + "/actuator/health/";
        var liveness = http.send(HttpRequest.newBuilder(URI.create(base + "liveness")).build(),
                HttpResponse.BodyHandlers.ofString());
        var readiness = http.send(HttpRequest.newBuilder(URI.create(base + "readiness")).build(),
                HttpResponse.BodyHandlers.ofString());
        // No Redis in this test: a Redis outage must not restart the pod (liveness
        // UP) but must take it out of rotation (readiness DOWN -> 503).
        assertThat(liveness.statusCode()).isEqualTo(200);
        assertThat(liveness.body()).contains("\"UP\"");
        assertThat(readiness.statusCode()).isEqualTo(503);
    }
}
