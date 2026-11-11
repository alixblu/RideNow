package cloudnative.microservices.matching;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * matching-service: finds candidate drivers for a trip and records the offers it
 * makes. It owns the matching decision and its state (trip_offers,
 * matching_driver_positions / later a Redis GEO index). It never reads another
 * service's data store directly - driver positions arrive via an explicit handoff.
 * Matching is triggered asynchronously by trip.requested events (SQS) and announces
 * each offer with a match.offered event (EventBridge).
 */
@SpringBootApplication
@EnableScheduling // drives the SQS poller for trip.requested
public class MatchingServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(MatchingServiceApplication.class, args);
    }
}
