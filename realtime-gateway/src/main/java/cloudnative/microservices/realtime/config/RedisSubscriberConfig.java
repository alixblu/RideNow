package cloudnative.microservices.realtime.config;

import cloudnative.microservices.realtime.service.LocationRelay;
import cloudnative.microservices.realtime.service.TripEndedRelay;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

/**
 * Subscribes this pod to the driver-location and trip-ended channels. EVERY
 * gateway pod subscribes (Pub/Sub fans out to all subscribers); a pod with no
 * stream for the trip simply drops the message.
 *
 * Switchable off ({@code ridenow.gateway.redis.enabled=false}) so tests can drive
 * the relays directly without a Redis server.
 */
@Configuration
@ConditionalOnProperty(name = "ridenow.gateway.redis.enabled", havingValue = "true", matchIfMissing = true)
public class RedisSubscriberConfig {

    @Bean
    RedisMessageListenerContainer gatewayListenerContainer(
            RedisConnectionFactory connectionFactory,
            LocationRelay locationRelay,
            TripEndedRelay tripEndedRelay,
            GatewayProperties properties) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(
                (message, pattern) -> locationRelay.onMessage(body(message.getBody())),
                new ChannelTopic(properties.locationsChannel()));
        container.addMessageListener(
                (message, pattern) -> tripEndedRelay.onMessage(body(message.getBody())),
                new ChannelTopic(properties.endedChannel()));
        return container;
    }

    private static String body(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
