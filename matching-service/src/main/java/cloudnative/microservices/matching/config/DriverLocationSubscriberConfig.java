package cloudnative.microservices.matching.config;

import cloudnative.microservices.matching.event.DriverLocationStreamConsumer;
import cloudnative.microservices.matching.event.DriverLocationStreamConsumer.Settings;
import cloudnative.microservices.matching.event.DriverLocationSubscriber;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Reads driver-service's location stream through a consumer group. On by default;
 * switch off with {@code ridenow.matching.location-subscriber.enabled=false}.
 */
@Configuration
@ConditionalOnProperty(name = "ridenow.matching.location-subscriber.enabled", havingValue = "true",
        matchIfMissing = true)
public class DriverLocationSubscriberConfig {

    @Bean
    DriverLocationStreamConsumer driverLocationStreamConsumer(
            StringRedisTemplate redis,
            DriverLocationSubscriber subscriber,
            @Value("${ridenow.matching.location-subscriber.stream:ridenow:stream:driver-locations}") String stream,
            @Value("${ridenow.matching.location-subscriber.group:matching}") String group,
            @Value("${ridenow.matching.location-subscriber.consumer-name:}") String consumerName,
            @Value("${ridenow.matching.location-subscriber.batch-size:100}") int batchSize,
            @Value("${ridenow.matching.location-subscriber.block-timeout:2s}") Duration blockTimeout,
            @Value("${ridenow.matching.location-subscriber.reclaim-idle:30s}") Duration reclaimIdle,
            @Value("${ridenow.matching.location-subscriber.reclaim-interval:30s}") Duration reclaimInterval,
            @Value("${ridenow.matching.location-subscriber.max-deliveries:5}") int maxDeliveries,
            @Value("${ridenow.matching.location-subscriber.dead-letter-stream:ridenow:stream:driver-locations-dlq}")
            String deadLetterStream,
            @Value("${ridenow.matching.location-subscriber.dead-letter-max-length:1000}") long deadLetterMaxLength) {
        return new DriverLocationStreamConsumer(redis, subscriber, new Settings(
                stream, group, consumerName.isBlank() ? defaultConsumerName() : consumerName, batchSize,
                blockTimeout, reclaimIdle, reclaimInterval, maxDeliveries, deadLetterStream,
                deadLetterMaxLength));
    }

    /** The pod's hostname: unique per pod on Kubernetes, and readable in XINFO output. */
    private static String defaultConsumerName() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (UnknownHostException e) {
            return "matching-" + UUID.randomUUID();
        }
    }
}
