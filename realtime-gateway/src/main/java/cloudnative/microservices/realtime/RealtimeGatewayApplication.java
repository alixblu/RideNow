package cloudnative.microservices.realtime;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * realtime-gateway: streams a driver's live position to the passenger of the trip
 * over SSE, and nothing else - no database, no business logic. driver-service
 * publishes positions to a Redis Pub/Sub channel and notification-worker keeps the
 * trip pairing keys; every gateway pod subscribes, and the pod holding the
 * passenger's stream delivers.
 *
 * The stream is an optimization, never the source of truth: clients draw the REST
 * snapshot first. See README.md and docs/REALTIME.md.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class RealtimeGatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(RealtimeGatewayApplication.class, args);
    }
}
