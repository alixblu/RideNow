package cloudnative.microservices.notification.repository;

import cloudnative.microservices.notification.entity.Notification;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    /** The newest rows for a user (descending); used when the client has no cursor yet. */
    List<Notification> findByUserIdOrderByCreatedAtDescIdDesc(UUID userId, Pageable page);

    /** Rows strictly after the cursor (createdAt, id), oldest first. */
    @Query("""
            select n from Notification n
            where n.userId = :userId
              and (n.createdAt > :createdAt or (n.createdAt = :createdAt and n.id > :id))
            order by n.createdAt asc, n.id asc
            """)
    List<Notification> findAfter(@Param("userId") UUID userId,
                                 @Param("createdAt") Instant createdAt,
                                 @Param("id") UUID id,
                                 Pageable page);
}
