package cloudnative.microservices.trip.service;

import cloudnative.microservices.trip.client.PaymentServiceClient;
import cloudnative.microservices.trip.dto.request.CreateTripRequest;
import cloudnative.microservices.trip.dto.response.PageResponse;
import cloudnative.microservices.trip.dto.response.TripOfferResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.entity.TripOffer;
import cloudnative.microservices.trip.entity.TripStatus;
import cloudnative.microservices.trip.event.DomainEventPublisher;
import cloudnative.microservices.trip.event.TripEvents;
import cloudnative.microservices.trip.exception.PaymentUnavailableException;
import cloudnative.microservices.trip.exception.ResourceNotFoundException;
import cloudnative.microservices.trip.repository.TripOfferRepository;
import cloudnative.microservices.trip.repository.TripRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class TripService {

    private static final Logger log = LoggerFactory.getLogger(TripService.class);

    private final TripRepository tripRepository;
    private final TripOfferRepository tripOfferRepository;
    private final ApplicationEventPublisher events;
    private final TripRecorder tripRecorder;
    private final FareEstimator fareEstimator;
    private final PaymentServiceClient paymentServiceClient;
    private final DomainEventPublisher eventPublisher;

    /**
     * Requests a trip: estimate the fare, authorize it synchronously with
     * payment-service, then save the trip (already SEARCHING) and raise
     * {@code trip.requested} so matching can start asynchronously.
     *
     * Strict by design: if the authorization is declined or payment-service is
     * unavailable, no trip is created. If the hold may exist but the trip could
     * not be saved, a compensating {@code trip.cancelled} event releases it.
     *
     * Deliberately not {@code @Transactional}: the payment call must not run inside
     * a database transaction, and the compensation must be able to run after a
     * failed commit. The local transaction lives in {@link TripRecorder}.
     */
    public TripResponse createTrip(CreateTripRequest request) {
        UUID tripId = UUID.randomUUID();
        BigDecimal estimatedFare = fareEstimator.estimate(
                request.rideType(), request.pickupLat(), request.pickupLng(),
                request.destinationLat(), request.destinationLng());

        try {
            paymentServiceClient.authorize(
                    tripId, request.passengerId(), estimatedFare, FareEstimator.CURRENCY,
                    request.paymentMethod());
        } catch (PaymentUnavailableException e) {
            // The request may have reached payment-service before it timed out, so a
            // hold could exist. Releasing a hold that does not exist is a no-op.
            compensate(tripId, "Payment authorization was unavailable");
            throw e;
        }
        // PaymentDeclinedException propagates untouched: a declined hold needs no release.

        Trip trip = new Trip(
                tripId, request.passengerId(), request.rideType(),
                request.pickupLat(), request.pickupLng(),
                request.destinationLat(), request.destinationLng(), estimatedFare, Instant.now());
        try {
            return toResponse(tripRecorder.recordRequested(trip));
        } catch (RuntimeException e) {
            compensate(tripId, "Trip could not be created");
            throw e;
        }
    }

    /** Best-effort release of a possibly-held authorization; never masks the original failure. */
    private void compensate(UUID tripId, String reason) {
        try {
            eventPublisher.publish(TripEvents.tripCreationFailed(tripId, reason));
        } catch (RuntimeException ex) {
            log.error("Could not publish compensation for trip {}: {}", tripId, ex.getMessage());
        }
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
        events.publishEvent(TripEvents.driverAccepted(trip));
        return toResponse(trip); // flushed on commit; version checked there
    }

    /** Driver has reached the pickup point. Legal only from DRIVER_ASSIGNED. */
    @Transactional
    public TripResponse arriveTrip(UUID tripId) {
        Trip trip = tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", tripId));
        trip.arrive(Instant.now());
        events.publishEvent(TripEvents.driverArrived(trip));
        return toResponse(trip);
    }

    /** Passenger is aboard; the trip begins. Legal only from DRIVER_ARRIVED. */
    @Transactional
    public TripResponse startTrip(UUID tripId) {
        Trip trip = tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", tripId));
        trip.start(Instant.now());
        events.publishEvent(TripEvents.tripStarted(trip));
        return toResponse(trip);
    }

    /** Trip is driven and done. Legal only from IN_PROGRESS. */
    @Transactional
    public TripResponse completeTrip(UUID tripId) {
        Trip trip = tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", tripId));
        trip.complete(Instant.now());
        events.publishEvent(TripEvents.tripCompleted(trip));
        return toResponse(trip);
    }

    @Transactional(readOnly = true)
    public TripResponse getTrip(UUID id) {
        Trip trip = tripRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", id));
        return toResponse(trip);
    }

    /**
     * Lists trips newest-first, optionally filtered by passenger and/or status.
     * The matching finder/count pair is chosen by which filters are present.
     */
    @Transactional(readOnly = true)
    public PageResponse<TripResponse> listTrips(
            UUID passengerIdOrNull, TripStatus statusOrNull, int limit, int offset) {
        int effectiveLimit = limit <= 0 ? 20 : Math.min(limit, 100);
        int effectiveOffset = Math.max(offset, 0);

        List<Trip> all;
        long total;
        if (passengerIdOrNull != null && statusOrNull != null) {
            all = tripRepository.findByPassengerIdAndStatusOrderByRequestedAtDesc(passengerIdOrNull, statusOrNull);
            total = tripRepository.countByPassengerIdAndStatus(passengerIdOrNull, statusOrNull);
        } else if (passengerIdOrNull != null) {
            all = tripRepository.findByPassengerIdOrderByRequestedAtDesc(passengerIdOrNull);
            total = tripRepository.countByPassengerId(passengerIdOrNull);
        } else if (statusOrNull != null) {
            all = tripRepository.findByStatusOrderByRequestedAtDesc(statusOrNull);
            total = tripRepository.countByStatus(statusOrNull);
        } else {
            all = tripRepository.findAllByOrderByRequestedAtDesc();
            total = tripRepository.count();
        }

        List<TripResponse> items;
        if (effectiveOffset >= all.size()) {
            items = List.of();
        } else {
            int end = Math.min(effectiveOffset + effectiveLimit, all.size());
            items = all.subList(effectiveOffset, end).stream()
                    .map(this::toResponse)
                    .toList();
        }
        return new PageResponse<>(items, total, effectiveLimit, effectiveOffset);
    }

    @Transactional
    public TripResponse cancelTrip(UUID tripId, String reason) {
        Trip trip = tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", tripId));
        trip.cancel(reason, Instant.now());
        events.publishEvent(TripEvents.tripCancelled(trip));
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