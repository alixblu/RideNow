package cloudnative.microservices.driver.live;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

/**
 * The seam to the live driver-state store. driver-service owns these Redis keys;
 * no other service reads or writes them directly (matching-service receives
 * updates through an explicit handoff instead). Keeping it behind an interface
 * means the Redis implementation can be swapped or faked in tests.
 */
public interface DriverLocationStore {

    /** Marks the driver ONLINE (available for offers). Resets the live TTL. */
    void goOnline(UUID driverId);

    /** Marks the driver OFFLINE and clears live state. */
    void goOffline(UUID driverId);

    /**
     * Records the driver's current position and refreshes the live TTL. Only
     * meaningful while ONLINE; implementations keep the ONLINE flag.
     */
    void updateLocation(UUID driverId, BigDecimal lat, BigDecimal lng);

    /** Returns the current live state, or empty if the driver is not online. */
    Optional<DriverLiveState> getState(UUID driverId);
}
