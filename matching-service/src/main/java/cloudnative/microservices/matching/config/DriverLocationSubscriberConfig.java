package cloudnative.microservices.matching.config;

import cloudnative.microservices.matching.event.DriverLocationSubscriber;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

/**
 * Subscribes to driver-service's location channel. On by default; switch off with
 * {@code ridenow.matching.location-subscriber.enabled=false}.
 */
@Configuration
@ConditionalOnProperty(name = "ridenow.matching.location-subscriber.enabled", havingValue = "true",
        matchIfMissing = true)
public class DriverLocationSubscriberConfig {

    @Bean
    RedisMessageListenerContainer driverLocationListenerContainer(
            RedisConnectionFactory connectionFactory,
            DriverLocationSubscriber subscriber,
            @Value("${ridenow.matching.location-subscriber.channel:ridenow:driver:locations}") String channel) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(
                (message, pattern) -> subscriber.onMessage(new String(message.getBody(), StandardCharsets.UTF_8)),
                new ChannelTopic(channel));
        return container;
    }
}
