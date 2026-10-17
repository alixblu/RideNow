package cloudnative.microservices.driver.service;

import cloudnative.microservices.driver.client.UserServiceClient;
import cloudnative.microservices.driver.dto.request.CreateDriverRequest;
import cloudnative.microservices.driver.dto.request.CreateVehicleRequest;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.VehicleResponse;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.entity.DriverStatus;
import cloudnative.microservices.driver.entity.Vehicle;
import cloudnative.microservices.driver.exception.DuplicateResourceException;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
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

    @Transactional(readOnly = true)
    public DriverResponse getDriver(UUID id) {
        Driver driver = driverRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Driver", id));
        return toResponse(driver);
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