package cloudnative.microservices.driver.repository;

import cloudnative.microservices.driver.entity.Driver;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DriverRepository extends JpaRepository<Driver, UUID> {

    // Spring Data derives the query from the method name:
    //   SELECT COUNT(...) > 0 FROM drivers WHERE license_number = ?
    boolean existsByLicenseNumber(String licenseNumber);

    boolean existsByUserId(UUID userId);
}
