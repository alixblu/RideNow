package cloudnative.microservices.realtime.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Tunables for the gateway. Defaults are safe for local use; the limits exist so
 * one misbehaving client cannot exhaust a pod.
 *
 * @param notificationsChannel      Redis Pub/Sub channel notification-worker publishes to
 * @param allowedOrigins            browser origins allowed to open a socket ("*" = any; local only)
 * @param maxMessageBytes           largest STOMP frame a client may send
 * @param maxSubscriptionsPerSession subscriptions one connection may hold
 * @param maxFramesPerWindow        frames one connection may send per {@code frameWindow}
 * @param frameWindow               the rate-limit window
 * @param heartbeat                 STOMP heartbeat interval in both directions (dead-socket cleanup)
 */
@ConfigurationProperties(prefix = "ridenow.gateway")
public record GatewayProperties(
        @DefaultValue("ridenow.notifications") String notificationsChannel,
        @DefaultValue("*") List<String> allowedOrigins,
        @DefaultValue("8192") int maxMessageBytes,
        @DefaultValue("5") int maxSubscriptionsPerSession,
        @DefaultValue("60") int maxFramesPerWindow,
        @DefaultValue("10s") Duration frameWindow,
        @DefaultValue("10s") Duration heartbeat
) {
}
