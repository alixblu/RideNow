package cloudnative.microservices.matching.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cloudnative.microservices.matching.dto.request.MatchRequest;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.TripOfferRepository;
import cloudnative.microservices.matching.service.MatchingService;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class TripRequestedHandlerTest {

    @Mock private MatchingService matchingService;
    @Mock private TripOfferRepository offerRepository;
    @InjectMocks private TripRequestedHandler handler;

    private final UUID tripId = UUID.randomUUID();

    private Map<String, String> validData() {
        Map<String, String> data = new HashMap<>();
        data.put("tripId", tripId.toString());
        data.put("rideType", "MOTORBIKE");
        data.put("pickupLat", "10.762622");
        data.put("pickupLng", "106.660172");
        return data;
    }

    private IncomingEvent event(String type, Map<String, String> data) {
        return new IncomingEvent(UUID.randomUUID(), type, tripId, data);
    }

    @Test
    void tripRequestedStartsAMatchForThePickup() {
        when(offerRepository.existsByTripId(tripId)).thenReturn(false);

        handler.handle(event("trip.requested", validData()));

        ArgumentCaptor<MatchRequest> captor = ArgumentCaptor.forClass(MatchRequest.class);
        verify(matchingService).match(captor.capture());
        MatchRequest request = captor.getValue();
        assertThat(request.tripId()).isEqualTo(tripId);
        assertThat(request.vehicleType()).isEqualTo(VehicleType.MOTORBIKE);
        assertThat(request.pickupLat()).isEqualByComparingTo(new BigDecimal("10.762622"));
        assertThat(request.pickupLng()).isEqualByComparingTo(new BigDecimal("106.660172"));
    }

    @Test
    void duplicateDeliveryForAnAlreadyMatchedTripIsSkipped() {
        when(offerRepository.existsByTripId(tripId)).thenReturn(true);

        handler.handle(event("trip.requested", validData()));

        verifyNoInteractions(matchingService);
    }

    @Test
    void otherEventTypesAreIgnored() {
        handler.handle(event("trip.completed", validData()));
        handler.handle(null);

        verifyNoInteractions(matchingService, offerRepository);
    }

    @Test
    void malformedEventsAreDroppedNotRetried() {
        Map<String, String> noCoords = validData();
        noCoords.remove("pickupLat");
        Map<String, String> badType = validData();
        badType.put("rideType", "SPACESHIP");

        handler.handle(event("trip.requested", noCoords));
        handler.handle(event("trip.requested", badType));
        handler.handle(event("trip.requested", null));

        verifyNoInteractions(matchingService, offerRepository);
    }

    @Test
    void unexpectedFailuresPropagateSoSqsRetriesAndEventuallyDeadLetters() {
        when(offerRepository.existsByTripId(tripId)).thenReturn(false);
        doThrow(new IllegalStateException("redis down")).when(matchingService).match(any());

        assertThatThrownBy(() -> handler.handle(event("trip.requested", validData())))
                .isInstanceOf(IllegalStateException.class);
    }
}
