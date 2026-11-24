package cloudnative.microservices.matching.service;

import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.DriverPositionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ingests driver position reports pushed from driver-service (the explicit
 * handoff). Upserts one row per driver in matching-service's own working copy
 * (Postgres) AND into the Redis GEO index it owns, so whichever finder is active
 * has fresh data. matching-service owns both stores; driver-service never writes
 * to them directly.
 *
 * <p>Reports arrive from a Redis stream, which delivers at least once and can
 * replay or reorder messages (retries, reclaimed entries, several pods). So the
 * ingest is idempotent and order-safe, keyed on the report's {@code recordedAt}:
 * a report that is not newer than the stored one is ignored, and so is a position
 * that is not newer than the driver's offline marker. A late or duplicate message
 * therefore can neither move a driver backwards nor bring an offline driver back.
 *
 * <p>Several matching pods read the same stream, so updates for one driver can be handled
 * at the same time. Each operation first takes a per-driver Postgres advisory lock (held to
 * the end of its transaction), so the check, the row write, the GEO write and the offline
 * marker for one driver never interleave across pods.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DriverPositionService {

    private final DriverPositionRepository positionRepository;
    private final DriverGeoIndex geoIndex;

    /** A report received now (the HTTP handoff, which carries no timestamp). */
    @Transactional
    public void reportPosition(UUID driverId, VehicleType vehicleType, BigDecimal lat, BigDecimal lng) {
        reportPosition(driverId, vehicleType, lat, lng, Instant.now());
    }

    /**
     * A report recorded at {@code recordedAt} (driver-service's clock). Ignored when
     * it is not newer than the stored position or than the driver's offline marker.
     */
    @Transactional
    public void reportPosition(UUID driverId, VehicleType vehicleType, BigDecimal lat, BigDecimal lng,
                               Instant recordedAt) {
        lock(driverId);
        Instant offlineAt = geoIndex.offlineAt(driverId);
        if (offlineAt != null && !recordedAt.isAfter(offlineAt)) {
            log.debug("Ignoring a position for {} recorded at or before the driver went offline", driverId);
            return;
        }
        Optional<DriverPosition> existing = positionRepository.findById(driverId);
        if (existing.isPresent() && !recordedAt.isAfter(existing.get().getReportedAt())) {
            log.debug("Ignoring a duplicate or older position for {}", driverId);
            return;
        }
        DriverPosition position = existing
                .map(current -> {
                    current.update(vehicleType, lat, lng, recordedAt);
                    return current;
                })
                .orElseGet(() -> new DriverPosition(driverId, vehicleType, lat, lng, recordedAt));
        positionRepository.save(position);

        // Keep the Redis GEO index (the query path for the redis finder) in sync.
        // A driver who switched vehicle type must leave the other type's index.
        for (VehicleType other : VehicleType.values()) {
            if (other != vehicleType) {
                geoIndex.remove(driverId, other);
            }
        }
        geoIndex.upsert(driverId, vehicleType, lat, lng);
    }

    /**
     * The driver went offline at {@code recordedAt}: drop them from both stores so no
     * new offer reaches them, and remember when, so a late position recorded before
     * this moment cannot resurrect them. Ignored when a newer position is already
     * stored (the driver came back online after this marker was produced).
     */
    @Transactional
    public void removeDriver(UUID driverId, Instant recordedAt) {
        lock(driverId);
        Optional<DriverPosition> existing = positionRepository.findById(driverId);
        if (existing.isPresent() && existing.get().getReportedAt().isAfter(recordedAt)) {
            log.debug("Ignoring an offline marker for {} older than the stored position", driverId);
            return;
        }
        positionRepository.deleteById(driverId);
        for (VehicleType type : VehicleType.values()) {
            geoIndex.remove(driverId, type);
        }
        geoIndex.markOffline(driverId, recordedAt);
    }

    /** Serializes work on one driver across pods until the surrounding transaction ends. */
    private void lock(UUID driverId) {
        positionRepository.lockDriver(driverId.getMostSignificantBits() ^ driverId.getLeastSignificantBits());
    }
}
