package cloudnative.microservices.matching.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.matching.entity.DriverPosition;
import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.repository.DriverPositionRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * The stream delivers at least once and can reorder, so ingest must be idempotent
 * and order-safe: late or duplicate reports change nothing.
 */
@ExtendWith(MockitoExtension.class)
class DriverPositionServiceTest {

    private static final Instant T1 = Instant.parse("2026-11-11T07:00:00Z");
    private static final Instant T2 = Instant.parse("2026-11-11T07:00:01Z");
    private static final Instant T3 = Instant.parse("2026-11-11T07:00:02Z");

    @Mock private DriverPositionRepository positionRepository;
    @Mock private DriverGeoIndex geoIndex;
    @InjectMocks private DriverPositionService service;

    private final UUID driverId = UUID.randomUUID();
    private final BigDecimal lat = new BigDecimal("10.5");
    private final BigDecimal lng = new BigDecimal("106.5");

    private DriverPosition stored(Instant reportedAt) {
        return new DriverPosition(driverId, VehicleType.CAR, new BigDecimal("1"), new BigDecimal("2"), reportedAt);
    }

    @Test
    void aFirstReportIsStoredAndIndexed() {
        when(positionRepository.findById(driverId)).thenReturn(Optional.empty());

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T1);

        verify(positionRepository).save(any(DriverPosition.class));
        verify(geoIndex).upsert(driverId, VehicleType.CAR, lat, lng);
    }

    @Test
    void aNewerReportReplacesTheStoredOne() {
        DriverPosition existing = stored(T1);
        when(positionRepository.findById(driverId)).thenReturn(Optional.of(existing));

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T2);

        assertThat(existing.getReportedAt()).isEqualTo(T2);
        assertThat(existing.getLat()).isEqualByComparingTo(lat);
        verify(geoIndex).upsert(driverId, VehicleType.CAR, lat, lng);
    }

    @Test
    void anOlderReportIsIgnored() {
        DriverPosition existing = stored(T2);
        when(positionRepository.findById(driverId)).thenReturn(Optional.of(existing));

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T1);

        assertThat(existing.getReportedAt()).isEqualTo(T2);
        verify(positionRepository, never()).save(any());
        verify(geoIndex, never()).upsert(any(), any(), any(), any());
    }

    @Test
    void aDuplicateReportIsIgnored() {
        when(positionRepository.findById(driverId)).thenReturn(Optional.of(stored(T2)));

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T2);

        verify(positionRepository, never()).save(any());
        verify(geoIndex, never()).upsert(any(), any(), any(), any());
    }

    @Test
    void aPositionRecordedBeforeTheDriverWentOfflineDoesNotBringThemBack() {
        when(geoIndex.offlineAt(driverId)).thenReturn(T2);

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T1);
        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T2);

        verify(positionRepository, never()).save(any());
        verify(geoIndex, never()).upsert(any(), any(), any(), any());
    }

    @Test
    void aPositionRecordedAfterTheDriverWentOfflineBringsThemBack() {
        when(geoIndex.offlineAt(driverId)).thenReturn(T1);
        when(positionRepository.findById(driverId)).thenReturn(Optional.empty());

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T2);

        verify(positionRepository).save(any(DriverPosition.class));
        verify(geoIndex).upsert(driverId, VehicleType.CAR, lat, lng);
    }

    @Test
    void goingOfflineRemovesTheDriverAndRemembersWhen() {
        when(positionRepository.findById(driverId)).thenReturn(Optional.of(stored(T1)));

        service.removeDriver(driverId, T2);

        verify(positionRepository).deleteById(driverId);
        for (VehicleType type : VehicleType.values()) {
            verify(geoIndex).remove(driverId, type);
        }
        verify(geoIndex).markOffline(driverId, T2);
    }

    @Test
    void anOfflineMarkerOlderThanTheStoredPositionIsIgnored() {
        when(positionRepository.findById(driverId)).thenReturn(Optional.of(stored(T3)));

        service.removeDriver(driverId, T2);

        verify(positionRepository, never()).deleteById(any());
        verify(geoIndex, never()).remove(any(), any());
        verify(geoIndex, never()).markOffline(any(), any());
    }

    @Test
    void goingOfflineWithNoStoredPositionStillRemembersWhen() {
        when(positionRepository.findById(driverId)).thenReturn(Optional.empty());

        service.removeDriver(driverId, T2);

        verify(geoIndex).markOffline(driverId, T2);
    }

    @Test
    void everyOperationTakesThePerDriverLockFirst() {
        when(positionRepository.findById(driverId)).thenReturn(Optional.empty());

        service.reportPosition(driverId, VehicleType.CAR, lat, lng, T1);
        service.removeDriver(driverId, T2);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(positionRepository);
        order.verify(positionRepository).lockDriver(anyLong());
        order.verify(positionRepository).findById(driverId);
        verify(positionRepository, org.mockito.Mockito.times(2)).lockDriver(anyLong());
    }
}
