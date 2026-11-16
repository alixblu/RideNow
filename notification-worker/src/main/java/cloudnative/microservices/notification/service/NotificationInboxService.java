package cloudnative.microservices.notification.service;

import cloudnative.microservices.notification.dto.NotificationResponse;
import cloudnative.microservices.notification.entity.Notification;
import cloudnative.microservices.notification.exception.InvalidCursorException;
import cloudnative.microservices.notification.exception.ResourceNotFoundException;
import cloudnative.microservices.notification.repository.NotificationRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reads a user's inbox and marks items read. */
@Service
@RequiredArgsConstructor
public class NotificationInboxService {

    /** Hard cap on one page, whatever the client asks for. */
    public static final int MAX_LIMIT = 100;

    private final NotificationRepository repository;

    /**
     * Items for {@code userId}, oldest first.
     *
     * <p>With a cursor ({@code since} = the id of the last item the client saw),
     * returns the items after it in (createdAt, id) order. Without one, returns the
     * newest {@code limit} items, still oldest first, so a first load shows recent
     * history.
     *
     * @throws InvalidCursorException {@code since} is not one of this user's items
     */
    @Transactional(readOnly = true)
    public List<NotificationResponse> list(UUID userId, UUID since, int limit) {
        PageRequest page = PageRequest.ofSize(Math.min(Math.max(limit, 1), MAX_LIMIT));
        List<Notification> rows;
        if (since == null) {
            rows = new ArrayList<>(repository.findByUserIdOrderByCreatedAtDescIdDesc(userId, page));
            Collections.reverse(rows);
        } else {
            Notification cursor = repository.findById(since)
                    .filter(n -> n.getUserId().equals(userId))
                    .orElseThrow(() -> new InvalidCursorException("Unknown 'since' cursor"));
            rows = repository.findAfter(userId, cursor.getCreatedAt(), cursor.getId(), page);
        }
        return rows.stream().map(NotificationResponse::from).toList();
    }

    @Transactional
    public NotificationResponse markRead(UUID id) {
        Notification notification = repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Notification not found: " + id));
        notification.markRead(Instant.now());
        return NotificationResponse.from(notification);
    }
}
