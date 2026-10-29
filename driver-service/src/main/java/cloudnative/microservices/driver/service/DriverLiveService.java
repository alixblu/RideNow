package cloudnative.microservices.driver.service;

import cloudnative.microservices.driver.dto.response.DriverLiveStateResponse;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.live.DriverLiveState;
import cloudnative.microservices.driver.live.DriverLocationStore;
import cloudnative.microservices.driver.live.LocationPublisher;
import cloudnative.microservices.driver.repository.DriverRepository;
import java.math.BigDecimal;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Live driver state (ONLINE/OFFLINE + current position). This is Redis-primary
 * state, so it lives OUTSIDE the JPA transactions in {@link DriverService}; reads
 * and writes go to the {@link DriverLocationStore}, never to Postgres.
 *
 * The durable driver profile still lives in Postgres: before a driver can go
 * online we confirm the account exists there (database-per-service: we own both
 * the driver table and this live state).
 */
@Service
@RequiredArgsConstructor
public class DriverLiveService {

    private final DriverRepository driverRepository;
    private final DriverLocationStore locationStore;
    private final LocationPublisher locationPublisher;

    public DriverLiveStateResponse goOnline(UUID driverId) {
        requireDriver(driverId);
        locationStore.goOnline(driverId);
        return toResponse(driverId);
    }

    public void goOffline(UUID driverId) {
        requireDriver(driverId);
        locationStore.goOffline(driverId);
    }

    public DriverLiveStateResponse updateLocation(UUID driverId, BigDecimal lat, BigDecimal lng) {
        requireDriver(driverId);
        locationStore.updateLocation(driverId, lat, lng);
        // Fire-and-forget on the live-tracking channel for any WebSocket layer.
        locationPublisher.publish(driverId, lat, lng);
        return toResponse(driverId);
    }

    public DriverLiveStateResponse getLiveState(UUID driverId) {
        requireDriver(driverId);
        return locationStore.getState(driverId)
                .map(DriverLiveService::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("Live state for driver", driverId));
    }

    private void requireDriver(UUID driverId) {
        if (!driverRepository.existsById(driverId)) {
            throw new ResourceNotFoundException("Driver", driverId);
        }
    }

    private DriverLiveStateResponse toResponse(UUID driverId) {
        return locationStore.getState(driverId)
                .map(DriverLiveService::toResponse)
                .orElse(new DriverLiveStateResponse(driverId, null, null, null, null));
    }

    private static DriverLiveStateResponse toResponse(DriverLiveState state) {
        return new DriverLiveStateResponse(
                state.driverId(), state.availability(), state.lat(), state.lng(), state.updatedAt());
    }
}
