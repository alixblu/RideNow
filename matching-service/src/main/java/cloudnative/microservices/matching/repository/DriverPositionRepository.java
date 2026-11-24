package cloudnative.microservices.matching.repository;

import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DriverPositionRepository extends JpaRepository<DriverPosition, UUID> {

    List<DriverPosition> findByVehicleType(VehicleType vehicleType);

    /**
     * Takes a Postgres advisory lock on {@code lockKey} that is held until the current
     * transaction ends. Two matching pods handling updates for the same driver then run
     * one after the other, so the check-then-write in
     * {@link cloudnative.microservices.matching.service.DriverPositionService} cannot
     * interleave (the row, the GEO index and the offline marker all change under the lock).
     * Must be called inside a transaction. The subquery wrapper is only there because the
     * lock function returns {@code void}, which JPA cannot map directly.
     */
    @Query(value = "SELECT count(*) FROM (SELECT pg_advisory_xact_lock(:lockKey)) AS acquired",
            nativeQuery = true)
    long lockDriver(@Param("lockKey") long lockKey);
}
