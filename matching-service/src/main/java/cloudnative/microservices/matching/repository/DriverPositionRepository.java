package cloudnative.microservices.matching.repository;

import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DriverPositionRepository extends JpaRepository<DriverPosition, UUID> {

    List<DriverPosition> findByVehicleType(VehicleType vehicleType);
}
