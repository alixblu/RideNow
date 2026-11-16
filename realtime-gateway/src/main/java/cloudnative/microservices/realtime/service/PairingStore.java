package cloudnative.microservices.realtime.service;

import cloudnative.microservices.realtime.dto.Pairing;
import java.util.Optional;
import java.util.UUID;

/**
 * Looks up the trip pairing that notification-worker keeps in Redis. A seam so the
 * rest of the gateway (and its tests) do not need a Redis server.
 */
public interface PairingStore {

    /** The pairing for a trip, or empty if it has not started tracking or has ended. */
    Optional<Pairing> findByTrip(UUID tripId);

    /** The pairing the driver is currently part of, or empty. */
    Optional<Pairing> findByDriver(UUID driverId);
}
