package cloudnative.microservices.driver.service;

import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.VehicleResponse;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.entity.Vehicle;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class DriverService {

    private final DriverRepository driverRepository;
    private final VehicleRepository vehicleRepository;

    public DriverResponse getDriver(UUID id) {
        Driver driver = driverRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Driver", id));
        return new DriverResponse(
                driver.getId(), driver.getUserId(), driver.getLicenseNumber(), driver.getStatus(),
                driver.getAverageRating(), driver.getTotalTrips(), driver.getCreatedAt(), driver.getUpdatedAt()
        );
    }

    public VehicleResponse getVehicle(UUID id) {
        Vehicle vehicle = vehicleRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Vehicle", id));
        return new VehicleResponse(
                vehicle.getId(), vehicle.getDriverId(), vehicle.getPlateNumber(), vehicle.getVehicleType(),
                vehicle.getBrand(), vehicle.getModel(), vehicle.getColor(), vehicle.isActive(),
                vehicle.getCreatedAt(), vehicle.getUpdatedAt()
        );
    }
}
