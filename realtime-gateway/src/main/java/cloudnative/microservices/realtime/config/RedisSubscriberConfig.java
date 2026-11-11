package cloudnative.microservices.realtime.config;

import cloudnative.microservices.realtime.service.NotificationRelay;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

/**
 * Subscribes this pod to the notifications channel. EVERY gateway pod subscribes
 * (Pub/Sub fans out to all subscribers), and the pod that holds the target user's
 * socket is the one whose broker has a subscriber for that user's topic; the
 * others simply have nobody to deliver to.
 *
 * Switchable off ({@code ridenow.gateway.redis.enabled=false}) so tests can drive
 * the relay directly without a Redis server.
 */
@Configuration
@ConditionalOnProperty(name = "ridenow.gateway.redis.enabled", havingValue = "true", matchIfMissing = true)
public class RedisSubscriberConfig {

    @Bean
    RedisMessageListenerContainer notificationListenerContainer(
            RedisConnectionFactory connectionFactory,
            NotificationRelay relay,
            GatewayProperties properties) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.addMessageListener(
                (message, pattern) -> relay.onMessage(new String(message.getBody(), StandardCharsets.UTF_8)),
                new ChannelTopic(properties.notificationsChannel()));
        return container;
    }
}
