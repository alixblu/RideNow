package cloudnative.microservices.trip.service;

import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.event.TripEvents;
import cloudnative.microservices.trip.repository.TripRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Owns the one local transaction of trip creation: save the new trip and raise
 * {@code trip.requested} (published after commit). It is a separate bean so that
 * {@link TripService#createTrip} can stay non-transactional: it must be able to
 * react to a failed commit (and publish a compensation event) after the
 * transaction is gone, which an enclosing transaction would not allow.
 */
@Service
@RequiredArgsConstructor
public class TripRecorder {

    private final TripRepository tripRepository;
    private final ApplicationEventPublisher events;

    @Transactional
    public Trip recordRequested(Trip trip) {
        Trip saved = tripRepository.save(trip);
        events.publishEvent(TripEvents.tripRequested(saved));
        return saved;
    }
}
