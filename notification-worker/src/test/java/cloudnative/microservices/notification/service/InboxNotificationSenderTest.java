package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;

import cloudnative.microservices.notification.dto.NotificationMessage;
import cloudnative.microservices.notification.entity.Notification;
import cloudnative.microservices.notification.repository.NotificationRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class InboxNotificationSenderTest {

    @Mock private NotificationRepository repository;
    @InjectMocks private InboxNotificationSender sender;

    private Notification saved() {
        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(repository).save(captor.capture());
        return captor.getValue();
    }

    @Test
    void writesOneUnreadRowWithEveryField() {
        UUID eventId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID tripId = UUID.randomUUID();

        sender.send(new NotificationMessage(eventId, userId, "trip.completed", "Your trip is complete.",
                tripId.toString(), "2026-11-11T07:00:00Z"));

        Notification row = saved();
        assertThat(row.getId()).isNotNull();
        assertThat(row.getUserId()).isEqualTo(userId);
        assertThat(row.getEventId()).isEqualTo(eventId);
        assertThat(row.getType()).isEqualTo("trip.completed");
        assertThat(row.getMessage()).isEqualTo("Your trip is complete.");
        assertThat(row.getTripId()).isEqualTo(tripId);
        assertThat(row.getOccurredAt()).isEqualTo(Instant.parse("2026-11-11T07:00:00Z"));
        assertThat(row.getCreatedAt()).isNotNull();
        assertThat(row.getReadAt()).isNull();
    }

    @Test
    void missingOrBadOptionalFieldsBecomeNull() {
        sender.send(new NotificationMessage(UUID.randomUUID(), UUID.randomUUID(), "trip.requested",
                "Looking for a driver near you.", "not-a-uuid", "yesterday"));

        Notification row = saved();
        assertThat(row.getTripId()).isNull();
        assertThat(row.getOccurredAt()).isNull();
    }
}
