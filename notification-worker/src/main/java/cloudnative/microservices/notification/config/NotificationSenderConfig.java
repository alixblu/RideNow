package cloudnative.microservices.notification.config;

import cloudnative.microservices.notification.service.LoggingNotificationSender;
import cloudnative.microservices.notification.service.NotificationSender;
import cloudnative.microservices.notification.service.RedisNotificationSender;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * Chooses the {@link NotificationSender}:
 * <ul>
 *   <li>{@code ridenow.notifications.delivery=redis} -> {@link RedisNotificationSender}
 *       (real delivery to the realtime-gateway / WebSocket);</li>
 *   <li>otherwise -> {@link LoggingNotificationSender} (the no-dependency default).</li>
 * </ul>
 * Both are @Bean factories in ONE class: beans of a class are registered in
 * declaration order, so the {@code @ConditionalOnMissingBean} fallback reliably
 * sees the Redis sender when it exists. A test can still replace either with its
 * own (e.g. {@code @Primary}) sender.
 */
@Configuration
public class NotificationSenderConfig {

    @Bean
    @ConditionalOnProperty(name = "ridenow.notifications.delivery", havingValue = "redis")
    NotificationSender redisNotificationSender(
            StringRedisTemplate redis,
            ObjectMapper objectMapper,
            @Value("${ridenow.notifications.redis-channel:ridenow.notifications}") String channel) {
        return new RedisNotificationSender(redis, objectMapper, channel);
    }

    @Bean
    @ConditionalOnMissingBean(NotificationSender.class)
    NotificationSender loggingNotificationSender() {
        return new LoggingNotificationSender();
    }
}
