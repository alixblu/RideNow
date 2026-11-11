package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.notification.dto.IncomingEvent;
import cloudnative.microservices.notification.dto.Notification;
import cloudnative.microservices.notification.entity.ProcessedNotification;
import cloudnative.microservices.notification.repository.ProcessedNotificationRepository;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    @Mock private ProcessedNotificationRepository processedRepository;
    @Mock private NotificationSender sender;

    private NotificationService service;

    private final UUID passenger = UUID.randomUUID();
    private final UUID driver = UUID.randomUUID();
    private final UUID tripId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        // The real resolver: these tests check the end-to-end "who gets what".
        service = new NotificationService(processedRepository, sender, new RecipientResolver());
    }

    private IncomingEvent event(String type) {
        return new IncomingEvent(UUID.randomUUID(), type, tripId, "2026-11-11T07:00:00Z", Map.of(
                "tripId", tripId.toString(),
                "passengerId", passenger.toString(),
                "driverId", driver.toString()));
    }

    @Test
    void acceptedTripTellsThePassengerWithEventIdTripAndTime() {
        IncomingEvent event = event("driver.accepted");

        service.handle(event);

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(sender).send(captor.capture());
        Notification sent = captor.getValue();
        assertThat(sent.userId()).isEqualTo(passenger);
        assertThat(sent.eventId()).isEqualTo(event.eventId());
        assertThat(sent.message()).isEqualTo("A driver has accepted your trip.");
        assertThat(sent.tripId()).isEqualTo(tripId.toString());
        assertThat(sent.occurredAt()).isEqualTo("2026-11-11T07:00:00Z");
        verify(processedRepository).save(any(ProcessedNotification.class));
    }

    @Test
    void cancellationSendsOneNotificationPerRecipient() {
        service.handle(event("trip.cancelled"));

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(sender, times(2)).send(captor.capture());
        assertThat(captor.getAllValues()).extracting(Notification::userId).containsExactly(passenger, driver);
        assertThat(captor.getAllValues()).extracting(Notification::eventId).containsOnly(
                captor.getAllValues().getFirst().eventId());
    }

    @Test
    void newEventTypesHaveTheirOwnText() {
        service.handle(event("trip.requested"));
        service.handle(event("trip.started"));
        service.handle(event("match.offered"));

        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);
        verify(sender, times(3)).send(captor.capture());
        assertThat(captor.getAllValues()).extracting(Notification::message).containsExactly(
                "Looking for a driver near you.", "Your trip has started.", "New ride request near you.");
        assertThat(captor.getAllValues().get(2).userId()).isEqualTo(driver);
    }

    @Test
    void duplicateDeliveryIsSkipped() {
        IncomingEvent event = event("driver.accepted");
        when(processedRepository.existsById(event.eventId())).thenReturn(true);

        assertThat(service.handle(event)).isTrue();

        verify(sender, never()).send(any());
        verify(processedRepository, never()).save(any());
    }

    @Test
    void anEventWithNoRecipientIsStillRecordedSoItIsNotRetried() {
        service.handle(new IncomingEvent(UUID.randomUUID(), "driver.accepted", tripId, null, Map.of()));

        verify(sender, never()).send(any());
        verify(processedRepository).save(any(ProcessedNotification.class));
    }

    @Test
    void aFailedSendIsNotRecordedSoTheMessageIsRetried() {
        doThrow(new IllegalStateException("redis down")).when(sender).send(any());

        assertThatThrownBy(() -> service.handle(event("driver.accepted")))
                .isInstanceOf(IllegalStateException.class);

        verify(processedRepository, never()).save(any());
    }
}
