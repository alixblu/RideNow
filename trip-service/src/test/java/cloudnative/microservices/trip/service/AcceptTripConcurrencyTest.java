package cloudnative.microservices.trip.service;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.trip.dto.request.CreateTripRequest;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.TripStatus;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * THE signature test of the project: many drivers try to accept the same ride at the
 * same instant. Proves that EXACTLY ONE wins and everyone else is cleanly rejected.
 *
 * Needs the local trip-db running (docker compose up -d in trip-service).
 */
@SpringBootTest
class AcceptTripConcurrencyTest {

    @Autowired
    private TripService tripService;

    @Test
    void exactlyOneDriverWinsWhenManyAcceptSimultaneously() throws InterruptedException {
        // Arrange: one trip, SEARCHING, visible to many drivers.
        TripResponse trip = tripService.createTrip(new CreateTripRequest(
                UUID.randomUUID(), RideType.CAR,
                new BigDecimal("10.762622"), new BigDecimal("106.660172"),
                new BigDecimal("10.776889"), new BigDecimal("106.700806")));

        int driverCount = 50;
        ExecutorService pool = Executors.newFixedThreadPool(driverCount);
        CountDownLatch ready = new CountDownLatch(driverCount);
        CountDownLatch go = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(driverCount);

        AtomicInteger winners = new AtomicInteger(0);
        AtomicInteger losers = new AtomicInteger(0);

        // Each thread is a driver tapping Accept.
        for (int i = 0; i < driverCount; i++) {
            UUID driverId = UUID.randomUUID();
            pool.submit(() -> {
                ready.countDown();
                try {
                    go.await();                 // all threads block here...
                    tripService.acceptTrip(trip.id(), driverId); // ...then race at once
                    winners.incrementAndGet();
                } catch (Exception e) {
                    losers.incrementAndGet();   // conflict / optimistic-lock failure
                } finally {
                    done.countDown();
                }
            });
        }

        ready.await(10, TimeUnit.SECONDS);      // wait until all threads are poised
        go.countDown();                         // release them simultaneously
        done.await(30, TimeUnit.SECONDS);
        pool.shutdownNow();

        // Assert: exactly one winner, the rest lost, and the DB reflects one assignment.
        System.out.println("WINNERS=" + winners.get() + " LOSERS=" + losers.get());
        assertThat(winners.get()).isEqualTo(1);
        assertThat(losers.get()).isEqualTo(driverCount - 1);

        TripResponse finalTrip = tripService.getTrip(trip.id());
        assertThat(finalTrip.status()).isEqualTo(TripStatus.DRIVER_ASSIGNED);
        assertThat(finalTrip.driverId()).isNotNull();
    }
}