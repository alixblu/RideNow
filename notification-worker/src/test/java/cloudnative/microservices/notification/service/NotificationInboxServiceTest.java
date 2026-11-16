package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.notification.dto.NotificationResponse;
import cloudnative.microservices.notification.entity.Notification;
import cloudnative.microservices.notification.exception.InvalidCursorException;
import cloudnative.microservices.notification.exception.ResourceNotFoundException;
import cloudnative.microservices.notification.repository.NotificationRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
class NotificationInboxServiceTest {

    @Mock private NotificationRepository repository;
    @InjectMocks private NotificationInboxService service;

    private final UUID userId = UUID.randomUUID();

    private Notification row(UUID owner, Instant createdAt) {
        return new Notification(UUID.randomUUID(), owner, UUID.randomUUID(), "trip.started",
                "Your trip has started.", UUID.randomUUID(), null, createdAt);
    }

    @Test
    void withoutACursorReturnsTheNewestItemsOldestFirst() {
        Instant t = Instant.parse("2026-11-11T07:00:00Z");
        Notification newer = row(userId, t.plusSeconds(10));
        Notification older = row(userId, t);
        // the repository returns newest first
        when(repository.findByUserIdOrderByCreatedAtDescIdDesc(eq(userId), any(Pageable.class)))
                .thenReturn(List.of(newer, older));

        List<NotificationResponse> result = service.list(userId, null, 50);

        assertThat(result).extracting(NotificationResponse::id).containsExactly(older.getId(), newer.getId());
    }

    @Test
    void withACursorReturnsItemsAfterIt() {
        Notification cursor = row(userId, Instant.parse("2026-11-11T07:00:00Z"));
        Notification next = row(userId, Instant.parse("2026-11-11T07:00:05Z"));
        when(repository.findById(cursor.getId())).thenReturn(Optional.of(cursor));
        when(repository.findAfter(eq(userId), eq(cursor.getCreatedAt()), eq(cursor.getId()), any(Pageable.class)))
                .thenReturn(List.of(next));

        List<NotificationResponse> result = service.list(userId, cursor.getId(), 50);

        assertThat(result).extracting(NotificationResponse::id).containsExactly(next.getId());
    }

    @Test
    void limitIsCappedAt100() {
        when(repository.findByUserIdOrderByCreatedAtDescIdDesc(eq(userId), any(Pageable.class)))
                .thenReturn(List.of());

        service.list(userId, null, 5000);

        ArgumentCaptor<Pageable> page = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findByUserIdOrderByCreatedAtDescIdDesc(eq(userId), page.capture());
        assertThat(page.getValue().getPageSize()).isEqualTo(NotificationInboxService.MAX_LIMIT);
    }

    @Test
    void anUnknownCursorIsRejected() {
        UUID unknown = UUID.randomUUID();
        when(repository.findById(unknown)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.list(userId, unknown, 50)).isInstanceOf(InvalidCursorException.class);
    }

    @Test
    void anotherUsersItemIsNotAValidCursor() {
        Notification theirs = row(UUID.randomUUID(), Instant.now());
        when(repository.findById(theirs.getId())).thenReturn(Optional.of(theirs));

        assertThatThrownBy(() -> service.list(userId, theirs.getId(), 50))
                .isInstanceOf(InvalidCursorException.class);
    }

    @Test
    void markReadSetsReadAtOnceAndKeepsTheFirstTime() {
        Notification n = row(userId, Instant.now());
        when(repository.findById(n.getId())).thenReturn(Optional.of(n));

        NotificationResponse first = service.markRead(n.getId());
        Instant firstRead = first.readAt();
        NotificationResponse second = service.markRead(n.getId());

        assertThat(firstRead).isNotNull();
        assertThat(second.readAt()).isEqualTo(firstRead);
    }

    @Test
    void markReadOnAnUnknownIdIsNotFound() {
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.markRead(id)).isInstanceOf(ResourceNotFoundException.class);
    }
}
