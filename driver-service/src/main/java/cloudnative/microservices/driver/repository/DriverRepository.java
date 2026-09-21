package cloudnative.microservices.driver.repository;

import cloudnative.microservices.driver.entity.Driver;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DriverRepository extends JpaRepository<Driver, UUID> {
}
