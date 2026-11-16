package cloudnative.microservices.driver.service;

import cloudnative.microservices.driver.dto.response.DriverLiveStateResponse;
import cloudnative.microservices.driver.entity.Vehicle;
import cloudnative.microservices.driver.entity.VehicleType;
import cloudnative.microservices.driver.exception.NoActiveVehicleException;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.live.DriverLiveState;
import cloudnative.microservices.driver.live.DriverLocationStore;
import cloudnative.microservices.driver.live.LocationPublisher;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.math.BigDecimal;
import java.time.Instant;
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
 *
 * A driver goes online with one vehicle: the one they pick, or else their newest
 * active vehicle. With neither, going online is refused, so every position on the
 * live channel carries the vehicle type matching needs.
 */
@Service
@RequiredArgsConstructor
public class DriverLiveService {

    private final DriverRepository driverRepository;
    private final VehicleRepository vehicleRepository;
    private final DriverLocationStore locationStore;
    private final LocationPublisher locationPublisher;

    /**
     * @param vehicleId the vehicle to drive, or null for the newest active vehicle
     * @throws NoActiveVehicleException the driver has no active vehicle, or picked an inactive one
     */
    public DriverLiveStateResponse goOnline(UUID driverId, UUID vehicleId) {
        requireDriver(driverId);
        Vehicle vehicle = vehicleId != null ? pickedVehicle(driverId, vehicleId) : newestActiveVehicle(driverId);
        locationStore.goOnline(driverId, vehicle.getVehicleType());
        return toResponse(driverId);
    }

    public void goOffline(UUID driverId) {
        requireDriver(driverId);
        locationStore.goOffline(driverId);
        locationPublisher.publishOffline(driverId, Instant.now());
    }

    public DriverLiveStateResponse updateLocation(UUID driverId, BigDecimal lat, BigDecimal lng) {
        requireDriver(driverId);
        locationStore.updateLocation(driverId, lat, lng);
        DriverLiveStateResponse state = toResponse(driverId);
        VehicleType vehicleType = state.vehicleType();
        if (vehicleType == null) {
            // The live record expired and the location write recreated it without the
            // vehicle. Fall back to the newest active vehicle, as going online would.
            vehicleType = vehicleRepository.findFirstByDriverIdAndActiveTrueOrderByCreatedAtDesc(driverId)
                    .map(Vehicle::getVehicleType)
                    .orElse(null);
            if (vehicleType != null) {
                locationStore.setVehicleType(driverId, vehicleType);
            }
        }
        Instant recordedAt = state.recordedAt() != null ? state.recordedAt() : Instant.now();
        // Fire-and-forget on the live-tracking channel (realtime-gateway, matching).
        locationPublisher.publish(driverId, lat, lng, recordedAt, vehicleType);
        return new DriverLiveStateResponse(state.driverId(), state.availability(), state.lat(), state.lng(),
                state.updatedAt(), state.recordedAt(), vehicleType);
    }

    public DriverLiveStateResponse getLiveState(UUID driverId) {
        requireDriver(driverId);
        return locationStore.getState(driverId)
                .map(DriverLiveService::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("Live state for driver", driverId));
    }

    private Vehicle pickedVehicle(UUID driverId, UUID vehicleId) {
        Vehicle vehicle = vehicleRepository.findById(vehicleId)
                .filter(v -> v.getDriverId().equals(driverId))
                .orElseThrow(() -> new ResourceNotFoundException("Vehicle", vehicleId));
        if (!vehicle.isActive()) {
            throw new NoActiveVehicleException("Vehicle " + vehicleId + " is not active; pick an active vehicle");
        }
        return vehicle;
    }

    private Vehicle newestActiveVehicle(UUID driverId) {
        return vehicleRepository.findFirstByDriverIdAndActiveTrueOrderByCreatedAtDesc(driverId)
                .orElseThrow(() -> new NoActiveVehicleException(
                        "Driver has no active vehicle; add a vehicle, or pick one with vehicleId"));
    }

    private void requireDriver(UUID driverId) {
        if (!driverRepository.existsById(driverId)) {
            throw new ResourceNotFoundException("Driver", driverId);
        }
    }

    private DriverLiveStateResponse toResponse(UUID driverId) {
        return locationStore.getState(driverId)
                .map(DriverLiveService::toResponse)
                .orElse(new DriverLiveStateResponse(driverId, null, null, null, null, null, null));
    }

    private static DriverLiveStateResponse toResponse(DriverLiveState state) {
        // The store stamps updatedAt on every position write, so it is the position time
        // whenever a position exists.
        Instant recordedAt = state.lat() != null ? state.updatedAt() : null;
        return new DriverLiveStateResponse(state.driverId(), state.availability(), state.lat(), state.lng(),
                state.updatedAt(), recordedAt, state.vehicleType());
    }
}
