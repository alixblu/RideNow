package cloudnative.microservices.realtime.config;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Tunables for the gateway. Defaults are safe for local use; the limits exist so
 * one misbehaving client cannot exhaust a pod.
 *
 * @param locationsChannel   Redis Pub/Sub channel driver-service publishes positions on
 * @param endedChannel       Redis Pub/Sub channel notification-worker publishes trip ends on
 * @param allowedOrigins     browser origins allowed to open a stream ("*" = any; local only)
 * @param maxStreamsPerTrip  streams one trip may hold on this pod; a new one evicts the oldest
 * @param minEventInterval   at most one {@code location} event per trip per this interval
 * @param pairingCacheTtl    how long a found driver-to-trip pairing is cached
 * @param negativeCacheTtl   how long "this driver has no pairing" is cached
 * @param streamTimeout      server-side lifetime of one stream; the client reconnects after it
 * @param retry              base SSE {@code retry:} reconnect delay; jittered by +/-50% per stream
 */
@ConfigurationProperties(prefix = "ridenow.gateway")
public record GatewayProperties(
        @DefaultValue("ridenow:driver:locations") String locationsChannel,
        @DefaultValue("ridenow:tracking:ended") String endedChannel,
        @DefaultValue("*") List<String> allowedOrigins,
        @DefaultValue("3") int maxStreamsPerTrip,
        @DefaultValue("1s") Duration minEventInterval,
        @DefaultValue("5s") Duration pairingCacheTtl,
        @DefaultValue("1s") Duration negativeCacheTtl,
        @DefaultValue("30m") Duration streamTimeout,
        @DefaultValue("3s") Duration retry
) {
}
