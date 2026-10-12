package cloudnative.microservices.driver.service;

import cloudnative.microservices.driver.dto.request.CreateDriverRequest;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.VehicleResponse;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.entity.Vehicle;
import cloudnative.microservices.driver.exception.DuplicateResourceException;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DriverService {

    private final DriverRepository driverRepository;
    private final VehicleRepository vehicleRepository;

    @Transactional(readOnly = true)
    public DriverResponse getDriver(UUID id) {
        Driver driver = driverRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Driver", id));
        return toResponse(driver);
    }

    /**
     * Creates a new driver profile.
     *
     * Business rules enforced here (not in the controller, not in the DB alone):
     *  - a user may have at most one driver profile
     *  - a license number is unique across drivers
     * Server owns id, status, counters, and timestamps.
     */
    @Transactional
    public DriverResponse createDriver(CreateDriverRequest request) {
        if (driverRepository.existsByUserId(request.userId())) {
            throw new DuplicateResourceException(
                    "A driver profile already exists for user " + request.userId());
        }
        if (driverRepository.existsByLicenseNumber(request.licenseNumber())) {
            throw new DuplicateResourceException(
                    "License number already registered: " + request.licenseNumber());
        }

        Driver driver = new Driver(
                UUID.randomUUID(),
                request.userId(),
                request.licenseNumber(),
                Instant.now()
        );
        Driver saved = driverRepository.save(driver);
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public VehicleResponse getVehicle(UUID id) {
        Vehicle vehicle = vehicleRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Vehicle", id));
        return new VehicleResponse(
                vehicle.getId(), vehicle.getDriverId(), vehicle.getPlateNumber(), vehicle.getVehicleType(),
                vehicle.getBrand(), vehicle.getModel(), vehicle.getColor(), vehicle.isActive(),
                vehicle.getCreatedAt(), vehicle.getUpdatedAt()
        );
    }

    private DriverResponse toResponse(Driver driver) {
        return new DriverResponse(
                driver.getId(), driver.getUserId(), driver.getLicenseNumber(), driver.getStatus(),
                driver.getAverageRating(), driver.getTotalTrips(), driver.getCreatedAt(), driver.getUpdatedAt()
        );
    }
}
