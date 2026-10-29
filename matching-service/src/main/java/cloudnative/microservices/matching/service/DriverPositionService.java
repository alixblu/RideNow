package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.DriverPositionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ingests driver position reports pushed from driver-service (the explicit
 * handoff). Upserts one row per driver in matching-service's own working copy
 * (Postgres) AND into the Redis GEO index it owns, so whichever finder is active
 * has fresh data. matching-service owns both stores; driver-service never writes
 * to them directly.
 */
@Service
@RequiredArgsConstructor
public class DriverPositionService {

    private final DriverPositionRepository positionRepository;
    private final DriverGeoIndex geoIndex;

    @Transactional
    public void reportPosition(UUID driverId, VehicleType vehicleType, BigDecimal lat, BigDecimal lng) {
        Instant now = Instant.now();
        DriverPosition position = positionRepository.findById(driverId)
                .map(existing -> {
                    existing.update(vehicleType, lat, lng, now);
                    return existing;
                })
                .orElseGet(() -> new DriverPosition(driverId, vehicleType, lat, lng, now));
        positionRepository.save(position);

        // Keep the Redis GEO index (the query path for the redis finder) in sync.
        geoIndex.upsert(driverId, vehicleType, lat, lng);
    }
}
