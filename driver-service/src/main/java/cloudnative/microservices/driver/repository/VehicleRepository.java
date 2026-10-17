package cloudnative.microservices.driver.repository;

import cloudnative.microservices.driver.entity.Vehicle;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VehicleRepository extends JpaRepository<Vehicle, UUID> {

    boolean existsByPlateNumber(String plateNumber);

    List<Vehicle> findByDriverId(UUID driverId);
}