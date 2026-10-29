package cloudnative.microservices.trip.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cloudnative.microservices.trip.dto.response.PageResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.entity.TripStatus;
import cloudnative.microservices.trip.exception.ResourceNotFoundException;
import cloudnative.microservices.trip.exception.TripNotCancellableException;
import cloudnative.microservices.trip.exception.TripTransitionException;
import cloudnative.microservices.trip.repository.TripOfferRepository;
import cloudnative.microservices.trip.repository.TripRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Trip listing and cancellation rules, verified with mocks (no running DB).
 * listTrips must pick the finder/count pair that matches the supplied filters,
 * clamp the limit, and window the results; cancelTrip must guard terminal states.
 */
@ExtendWith(MockitoExtension.class)
class TripServiceTest {

    @Mock private TripRepository tripRepository;
    @Mock private TripOfferRepository tripOfferRepository;
    @Mock private org.springframework.context.ApplicationEventPublisher events;

    @InjectMocks private TripService tripService;

    /** Builds a fresh SEARCHING trip with the given passenger and timestamp. */
    private Trip searchingTrip(UUID passengerId, Instant now) {
        return new Trip(UUID.randomUUID(), passengerId, RideType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"),
                new BigDecimal("10.100000"), new BigDecimal("106.100000"), now);
    }

    private List<Trip> trips(int n) {
        Instant now = Instant.now();
        return IntStream.range(0, n)
                .mapToObj(i -> searchingTrip(UUID.randomUUID(), now))
                .toList();
    }

    // --- listTrips finder selection -----------------------------------------

    @Test
    void listTripsWithNoFiltersUsesFindAll() {
        when(tripRepository.findAllByOrderByRequestedAtDesc()).thenReturn(trips(2));
        when(tripRepository.count()).thenReturn(2L);

        PageResponse<TripResponse> page = tripService.listTrips(null, null, 20, 0);

        assertThat(page.items()).hasSize(2);
        assertThat(page.total()).isEqualTo(2L);
        verify(tripRepository).findAllByOrderByRequestedAtDesc();
    }

    @Test
    void listTripsWithPassengerOnlyUsesPassengerFinder() {
        UUID passengerId = UUID.randomUUID();
        when(tripRepository.findByPassengerIdOrderByRequestedAtDesc(passengerId)).thenReturn(trips(1));
        when(tripRepository.countByPassengerId(passengerId)).thenReturn(1L);

        PageResponse<TripResponse> page = tripService.listTrips(passengerId, null, 20, 0);

        assertThat(page.items()).hasSize(1);
        assertThat(page.total()).isEqualTo(1L);
        verify(tripRepository).findByPassengerIdOrderByRequestedAtDesc(passengerId);
    }

    @Test
    void listTripsWithStatusOnlyUsesStatusFinder() {
        when(tripRepository.findByStatusOrderByRequestedAtDesc(TripStatus.SEARCHING)).thenReturn(trips(3));
        when(tripRepository.countByStatus(TripStatus.SEARCHING)).thenReturn(3L);

        PageResponse<TripResponse> page = tripService.listTrips(null, TripStatus.SEARCHING, 20, 0);

        assertThat(page.items()).hasSize(3);
        assertThat(page.total()).isEqualTo(3L);
        verify(tripRepository).findByStatusOrderByRequestedAtDesc(TripStatus.SEARCHING);
    }

    @Test
    void listTripsWithPassengerAndStatusUsesCombinedFinder() {
        UUID passengerId = UUID.randomUUID();
        when(tripRepository.findByPassengerIdAndStatusOrderByRequestedAtDesc(passengerId, TripStatus.SEARCHING))
                .thenReturn(trips(1));
        when(tripRepository.countByPassengerIdAndStatus(passengerId, TripStatus.SEARCHING)).thenReturn(1L);

        PageResponse<TripResponse> page = tripService.listTrips(passengerId, TripStatus.SEARCHING, 20, 0);

        assertThat(page.items()).hasSize(1);
        assertThat(page.total()).isEqualTo(1L);
        verify(tripRepository).findByPassengerIdAndStatusOrderByRequestedAtDesc(passengerId, TripStatus.SEARCHING);
    }

    // --- listTrips clamp and window -----------------------------------------

    @Test
    void listTripsAppliesDefaultLimitWhenNotPositive() {
        when(tripRepository.findAllByOrderByRequestedAtDesc()).thenReturn(trips(5));
        when(tripRepository.count()).thenReturn(5L);

        PageResponse<TripResponse> page = tripService.listTrips(null, null, 0, 0);

        assertThat(page.limit()).isEqualTo(20);
        assertThat(page.items()).hasSize(5);
    }

    @Test
    void listTripsClampsLimitToHundred() {
        when(tripRepository.findAllByOrderByRequestedAtDesc()).thenReturn(trips(150));
        when(tripRepository.count()).thenReturn(150L);

        PageResponse<TripResponse> page = tripService.listTrips(null, null, 500, 0);

        assertThat(page.limit()).isEqualTo(100);
        assertThat(page.items()).hasSize(100);
        assertThat(page.total()).isEqualTo(150L);
    }

    @Test
    void listTripsReturnsCorrectWindowInRepositoryOrder() {
        List<Trip> all = trips(10);
        when(tripRepository.findAllByOrderByRequestedAtDesc()).thenReturn(all);
        when(tripRepository.count()).thenReturn(10L);

        PageResponse<TripResponse> page = tripService.listTrips(null, null, 3, 4);

        assertThat(page.offset()).isEqualTo(4);
        assertThat(page.limit()).isEqualTo(3);
        assertThat(page.items()).extracting(TripResponse::id)
                .containsExactly(all.get(4).getId(), all.get(5).getId(), all.get(6).getId());
    }

    @Test
    void listTripsReturnsEmptyWhenOffsetBeyondSize() {
        when(tripRepository.findAllByOrderByRequestedAtDesc()).thenReturn(trips(3));
        when(tripRepository.count()).thenReturn(3L);

        PageResponse<TripResponse> page = tripService.listTrips(null, null, 20, 50);

        assertThat(page.items()).isEmpty();
        assertThat(page.total()).isEqualTo(3L);
    }

    // --- cancelTrip ----------------------------------------------------------

    @Test
    void cancelTripFromSearchingSetsCancelledState() {
        UUID tripId = UUID.randomUUID();
        Trip trip = searchingTrip(UUID.randomUUID(), Instant.now());
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(trip));

        TripResponse response = tripService.cancelTrip(tripId, "Cancelled by rider");

        assertThat(response.status()).isEqualTo(TripStatus.CANCELLED);
        assertThat(response.cancelledAt()).isNotNull();
        assertThat(response.cancellationReason()).isEqualTo("Cancelled by rider");
    }

    @Test
    void cancelTripWhenAlreadyCancelledThrows() {
        UUID tripId = UUID.randomUUID();
        Trip trip = searchingTrip(UUID.randomUUID(), Instant.now());
        trip.cancel("earlier", Instant.now());
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(trip));

        assertThatThrownBy(() -> tripService.cancelTrip(tripId, "Cancelled by rider"))
                .isInstanceOf(TripNotCancellableException.class);
    }

    @Test
    void cancelTripOnMissingIdThrowsResourceNotFound() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> tripService.cancelTrip(tripId, "Cancelled by rider"))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(tripOfferRepository);
    }

    // --- lifecycle transitions: arrive / start / complete --------------------

    /** Drives a fresh trip through accept so it is DRIVER_ASSIGNED. */
    private Trip assignedTrip() {
        Trip trip = searchingTrip(UUID.randomUUID(), Instant.now());
        trip.acceptBy(UUID.randomUUID(), Instant.now());
        return trip;
    }

    @Test
    void arriveFromAssignedSetsArrivedState() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(assignedTrip()));

        TripResponse response = tripService.arriveTrip(tripId);

        assertThat(response.status()).isEqualTo(TripStatus.DRIVER_ARRIVED);
        assertThat(response.arrivedAt()).isNotNull();
    }

    @Test
    void arriveRaisesDriverArrivedEvent() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(assignedTrip()));

        tripService.arriveTrip(tripId);

        org.mockito.ArgumentCaptor<cloudnative.microservices.trip.event.DomainEvent> captor =
                org.mockito.ArgumentCaptor.forClass(cloudnative.microservices.trip.event.DomainEvent.class);
        verify(events).publishEvent(captor.capture());
        assertThat(captor.getValue().type())
                .isEqualTo(cloudnative.microservices.trip.event.TripEvents.DRIVER_ARRIVED);
    }

    @Test
    void completeRaisesTripCompletedEvent() {
        UUID tripId = UUID.randomUUID();
        Trip trip = assignedTrip();
        trip.arrive(Instant.now());
        trip.start(Instant.now());
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(trip));

        tripService.completeTrip(tripId);

        org.mockito.ArgumentCaptor<cloudnative.microservices.trip.event.DomainEvent> captor =
                org.mockito.ArgumentCaptor.forClass(cloudnative.microservices.trip.event.DomainEvent.class);
        verify(events).publishEvent(captor.capture());
        assertThat(captor.getValue().type())
                .isEqualTo(cloudnative.microservices.trip.event.TripEvents.TRIP_COMPLETED);
    }

    @Test
    void illegalTransitionRaisesNoEvent() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(searchingTrip(UUID.randomUUID(), Instant.now())));

        assertThatThrownBy(() -> tripService.arriveTrip(tripId))
                .isInstanceOf(TripTransitionException.class);
        verify(events, never()).publishEvent(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void arriveFromSearchingThrows() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(searchingTrip(UUID.randomUUID(), Instant.now())));

        assertThatThrownBy(() -> tripService.arriveTrip(tripId))
                .isInstanceOf(TripTransitionException.class);
    }

    @Test
    void startFromArrivedSetsInProgressState() {
        UUID tripId = UUID.randomUUID();
        Trip trip = assignedTrip();
        trip.arrive(Instant.now());
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(trip));

        TripResponse response = tripService.startTrip(tripId);

        assertThat(response.status()).isEqualTo(TripStatus.IN_PROGRESS);
        assertThat(response.startedAt()).isNotNull();
    }

    @Test
    void startBeforeArriveThrows() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(assignedTrip()));

        assertThatThrownBy(() -> tripService.startTrip(tripId))
                .isInstanceOf(TripTransitionException.class);
    }

    @Test
    void completeFromInProgressSetsCompletedState() {
        UUID tripId = UUID.randomUUID();
        Trip trip = assignedTrip();
        trip.arrive(Instant.now());
        trip.start(Instant.now());
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(trip));

        TripResponse response = tripService.completeTrip(tripId);

        assertThat(response.status()).isEqualTo(TripStatus.COMPLETED);
        assertThat(response.completedAt()).isNotNull();
    }

    @Test
    void completeBeforeStartThrows() {
        UUID tripId = UUID.randomUUID();
        Trip trip = assignedTrip();
        trip.arrive(Instant.now());
        when(tripRepository.findById(tripId)).thenReturn(Optional.of(trip));

        assertThatThrownBy(() -> tripService.completeTrip(tripId))
                .isInstanceOf(TripTransitionException.class);
    }

    @Test
    void arriveOnMissingIdThrowsResourceNotFound() {
        UUID tripId = UUID.randomUUID();
        when(tripRepository.findById(tripId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> tripService.arriveTrip(tripId))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
