package cloudnative.microservices.notification.repository;

import cloudnative.microservices.notification.entity.ProcessedNotification;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedNotificationRepository extends JpaRepository<ProcessedNotification, UUID> {
}
