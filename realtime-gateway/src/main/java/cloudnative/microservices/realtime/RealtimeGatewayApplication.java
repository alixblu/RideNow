package cloudnative.microservices.realtime;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * realtime-gateway: owns the WebSocket (STOMP) connections to the rider and
 * driver apps and nothing else - no database, no business logic. notification-
 * worker publishes each notification to a Redis Pub/Sub channel; every gateway
 * pod subscribes, and the pod that holds the target user's socket pushes it.
 *
 * The socket is an optimization, never the source of truth: clients re-fetch
 * current state over REST on every (re)connect. See README.md.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class RealtimeGatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(RealtimeGatewayApplication.class, args);
    }
}
