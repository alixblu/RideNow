package cloudnative.microservices.trip.service;

import cloudnative.microservices.trip.dto.request.CreateTripRequest;
import cloudnative.microservices.trip.dto.response.TripOfferResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.entity.TripOffer;
import cloudnative.microservices.trip.exception.ResourceNotFoundException;
import cloudnative.microservices.trip.repository.TripOfferRepository;
import cloudnative.microservices.trip.repository.TripRepository;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class TripService {

    private final TripRepository tripRepository;
    private final TripOfferRepository tripOfferRepository;

    /**
     * Creates a trip already in SEARCHING, ready to be offered to drivers.
     * (Minimal creation for the concurrency lab.)
     */
    @Transactional
    public TripResponse createTrip(CreateTripRequest request) {
        Trip trip = new Trip(
                UUID.randomUUID(), request.passengerId(), request.rideType(),
                request.pickupLat(), request.pickupLng(),
                request.destinationLat(), request.destinationLng(), Instant.now());
        return toResponse(tripRepository.save(trip));
    }

    /**
     * THE concurrency-critical operation. Runs in its own transaction.
     *
     * How exactly-one-winner is guaranteed:
     *  1. Load the trip.
     *  2. acceptBy(...) throws if it is not SEARCHING (business guard).
     *  3. On commit, JPA issues:
     *        UPDATE trips SET driver_id=?, status=?, version=version+1
     *        WHERE id=? AND version=?        (the @Version optimistic lock)
     *     If another transaction already incremented the version, this UPDATE
     *     matches 0 rows and JPA throws OptimisticLockingFailureException.
     *
     * Net effect under a race: one thread commits and wins; every other thread
     * either fails the SEARCHING guard or the version check, and is rejected with
     * 409. The ride is never assigned twice.
     */
    @Transactional
    public TripResponse acceptTrip(UUID tripId, UUID driverId) {
        Trip trip = tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", tripId));
        trip.acceptBy(driverId, Instant.now());
        return toResponse(trip); // flushed on commit; version checked there
    }

    @Transactional(readOnly = true)
    public TripResponse getTrip(UUID id) {
        Trip trip = tripRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", id));
        return toResponse(trip);
    }

    @Transactional(readOnly = true)
    public TripOfferResponse getTripOffer(UUID id) {
        TripOffer tripOffer = tripOfferRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Trip offer", id));
        return new TripOfferResponse(
                tripOffer.getId(), tripOffer.getTripId(), tripOffer.getDriverId(), tripOffer.getStatus(),
                tripOffer.getDistanceMeters(), tripOffer.getOfferedAt(), tripOffer.getRespondedAt(),
                tripOffer.getExpiresAt()
        );
    }

    private TripResponse toResponse(Trip trip) {
        return new TripResponse(
                trip.getId(), trip.getPassengerId(), trip.getDriverId(), trip.getVehicleId(), trip.getRideType(),
                trip.getPickupLat(), trip.getPickupLng(), trip.getPickupAddress(),
                trip.getDestinationLat(), trip.getDestinationLng(), trip.getDestinationAddress(), trip.getStatus(),
                trip.getEstimatedFare(), trip.getFinalFare(), trip.getCancellationReason(), trip.getVersion(),
                trip.getRequestedAt(), trip.getAcceptedAt(), trip.getArrivedAt(), trip.getStartedAt(),
                trip.getCompletedAt(), trip.getCancelledAt(), trip.getCreatedAt(), trip.getUpdatedAt()
        );
    }
}