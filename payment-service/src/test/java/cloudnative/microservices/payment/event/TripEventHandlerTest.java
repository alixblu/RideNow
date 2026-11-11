package cloudnative.microservices.payment.event;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cloudnative.microservices.payment.exception.ResourceNotFoundException;
import cloudnative.microservices.payment.service.PaymentService;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TripEventHandlerTest {

    @Mock private PaymentService paymentService;
    @InjectMocks private TripEventHandler handler;

    private final UUID tripId = UUID.randomUUID();
    private final UUID passengerId = UUID.randomUUID();

    private IncomingEvent event(String type, Map<String, String> data) {
        return new IncomingEvent(UUID.randomUUID(), type, tripId, data);
    }

    private Map<String, String> data(String... kv) {
        Map<String, String> map = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            map.put(kv[i], kv[i + 1]);
        }
        return map;
    }

    @Test
    void tripCompletedCapturesTheFinalFare() {
        handler.handle(event("trip.completed", data(
                "tripId", tripId.toString(), "finalFare", "52000.00", "passengerId", passengerId.toString())));

        verify(paymentService).capture(tripId, new BigDecimal("52000.00"), passengerId);
    }

    @Test
    void tripCompletedWithoutFareFallsBackToTheAuthorizedAmount() {
        handler.handle(event("trip.completed", data("tripId", tripId.toString())));

        verify(paymentService).capture(tripId, null, null);
    }

    @Test
    void tripCancelledReleasesTheHold() {
        handler.handle(event("trip.cancelled", data("tripId", tripId.toString())));

        verify(paymentService).release(tripId);
        verify(paymentService, never()).capture(any(), any(), any());
    }

    @Test
    void otherEventTypesAreIgnored() {
        handler.handle(event("driver.accepted", data("tripId", tripId.toString())));
        handler.handle(event("trip.requested", data("tripId", tripId.toString())));

        verifyNoInteractions(paymentService);
    }

    @Test
    void malformedEventsAreDroppedNotRetried() {
        handler.handle(event("trip.completed", data()));
        handler.handle(event("trip.completed", data("tripId", "not-a-uuid")));
        handler.handle(event("trip.completed", data("tripId", tripId.toString(), "finalFare", "abc")));
        handler.handle(new IncomingEvent(UUID.randomUUID(), null, null, null));
        handler.handle(null);

        verifyNoInteractions(paymentService);
    }

    @Test
    void noPaymentForTheTripIsDroppedNotRetried() {
        when(paymentService.release(eq(tripId))).thenThrow(new ResourceNotFoundException("Payment for trip", tripId));

        handler.handle(event("trip.cancelled", data("tripId", tripId.toString())));
        // reaching here without an exception is the assertion: the message gets deleted
    }

    @Test
    void unexpectedFailuresPropagateSoSqsRetriesAndEventuallyDeadLetters() {
        doThrow(new IllegalStateException("db down")).when(paymentService).capture(any(), any(), any());

        assertThatThrownBy(() -> handler.handle(event("trip.completed", data("tripId", tripId.toString()))))
                .isInstanceOf(IllegalStateException.class);
    }
}
