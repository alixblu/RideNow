package cloudnative.microservices.driver.service;

import cloudnative.microservices.driver.client.UserServiceClient;
import cloudnative.microservices.driver.dto.request.CreateDriverRequest;
import cloudnative.microservices.driver.dto.request.CreateVehicleRequest;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.PageResponse;
import cloudnative.microservices.driver.dto.response.VehicleResponse;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.entity.DriverStatus;
import cloudnative.microservices.driver.entity.Vehicle;
import cloudnative.microservices.driver.exception.DuplicateResourceException;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.cache.DriverProfileCache;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DriverService {

    private final DriverRepository driverRepository;
    private final VehicleRepository vehicleRepository;
    private final UserServiceClient userServiceClient;
    private final DriverProfileCache profileCache;

    /**
     * Reads a driver profile, cache-aside: serve from Redis on a hit; on a miss
     * read Postgres (the source of truth) and populate the cache. The profile is
     * a good cache candidate - read often, changes rarely - and any write evicts
     * the entry, so staleness is bounded by writes and the TTL.
     */
    @Transactional(readOnly = true)
    public DriverResponse getDriver(UUID id) {
        return profileCache.get(id).orElseGet(() -> {
            Driver driver = driverRepository.findById(id)
                    .orElseThrow(() -> new ResourceNotFoundException("Driver", id));
            DriverResponse response = toResponse(driver);
            profileCache.put(response);
            return response;
        });
    }

    @Transactional(readOnly = true)
    public PageResponse<DriverResponse> listDrivers(int limit, int offset, DriverStatus statusOrNull) {
        // Clamp the page size to a sane range and keep offset non-negative so a
        // caller can never ask for an unbounded result or a negative window.
        int safeLimit = limit <= 0 ? 20 : Math.min(limit, 100);
        int safeOffset = Math.max(offset, 0);

        List<Driver> all;
        long total;
        if (statusOrNull != null) {
            all = driverRepository.findByStatusOrderByCreatedAtDesc(statusOrNull);
            total = driverRepository.countByStatus(statusOrNull);
        } else {
            all = driverRepository.findAllByOrderByCreatedAtDesc();
            total = driverRepository.count();
        }

        // Slice [offset, offset + limit) defensively: an offset past the end
        // yields an empty page instead of an exception.
        int from = Math.min(safeOffset, all.size());
        int to = Math.min(from + safeLimit, all.size());
        List<DriverResponse> items = all.subList(from, to).stream().map(this::toResponse).toList();

        return new PageResponse<>(items, total, safeLimit, safeOffset);
    }

    @Transactional
    public DriverResponse createDriver(CreateDriverRequest request) {
        // Cross-service check: the user must exist. driver-service does not own user
        // data, so it ASKS user-service over HTTP instead of reading its tables.
        if (!userServiceClient.userExists(request.userId())) {
            throw new ResourceNotFoundException("User", request.userId());
        }
        if (driverRepository.existsByUserId(request.userId())) {
            throw new DuplicateResourceException(
                    "A driver profile already exists for user " + request.userId());
        }
        if (driverRepository.existsByLicenseNumber(request.licenseNumber())) {
            throw new DuplicateResourceException(
                    "License number already registered: " + request.licenseNumber());
        }
        Driver driver = new Driver(UUID.randomUUID(), request.userId(), request.licenseNumber(), Instant.now());
        return toResponse(driverRepository.save(driver));
    }

    @Transactional
    public VehicleResponse addVehicle(UUID driverId, CreateVehicleRequest request) {
        if (!driverRepository.existsById(driverId)) {
            throw new ResourceNotFoundException("Driver", driverId);
        }
        if (vehicleRepository.existsByPlateNumber(request.plateNumber())) {
            throw new DuplicateResourceException("Plate number already registered: " + request.plateNumber());
        }
        Vehicle vehicle = new Vehicle(UUID.randomUUID(), driverId, request.plateNumber(), request.vehicleType(),
                request.brand(), request.model(), request.color(), Instant.now());
        return toVehicleResponse(vehicleRepository.save(vehicle));
    }

    @Transactional(readOnly = true)
    public List<VehicleResponse> listVehicles(UUID driverId) {
        if (!driverRepository.existsById(driverId)) {
            throw new ResourceNotFoundException("Driver", driverId);
        }
        return vehicleRepository.findByDriverId(driverId).stream().map(this::toVehicleResponse).toList();
    }

    @Transactional
    public DriverResponse changeStatus(UUID driverId, DriverStatus newStatus) {
        Driver driver = driverRepository.findById(driverId)
                .orElseThrow(() -> new ResourceNotFoundException("Driver", driverId));
        driver.changeStatus(newStatus, Instant.now());
        // Invalidate the cached profile so the next read reflects the change.
        profileCache.evict(driverId);
        return toResponse(driver);
    }

    @Transactional(readOnly = true)
    public VehicleResponse getVehicle(UUID id) {
        Vehicle vehicle = vehicleRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Vehicle", id));
        return toVehicleResponse(vehicle);
    }

    private DriverResponse toResponse(Driver driver) {
        return new DriverResponse(
                driver.getId(), driver.getUserId(), driver.getLicenseNumber(), driver.getStatus(),
                driver.getAverageRating(), driver.getTotalTrips(), driver.getCreatedAt(), driver.getUpdatedAt()
        );
    }

    private VehicleResponse toVehicleResponse(Vehicle v) {
        return new VehicleResponse(
                v.getId(), v.getDriverId(), v.getPlateNumber(), v.getVehicleType(),
                v.getBrand(), v.getModel(), v.getColor(), v.isActive(), v.getCreatedAt(), v.getUpdatedAt()
        );
    }
}