package cloudnative.microservices.notification.config;

import cloudnative.microservices.notification.service.LoggingNotificationSender;
import cloudnative.microservices.notification.service.NotificationSender;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the default {@link LoggingNotificationSender} only when no other
 * {@link NotificationSender} bean is present, so a real provider (or a test
 * sender) can replace it cleanly. Using a @Bean factory with
 * {@code @ConditionalOnMissingBean} avoids the component-scan ordering pitfalls
 * of putting the condition directly on a scanned @Component.
 */
@Configuration
public class NotificationSenderConfig {

    @Bean
    @ConditionalOnMissingBean(NotificationSender.class)
    NotificationSender loggingNotificationSender() {
        return new LoggingNotificationSender();
    }
}
