package cloudnative.microservices.driver.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.driver.client.UserServiceClient;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.PageResponse;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.entity.DriverStatus;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Paginated driver listing rules, verified with mocks (no running DB).
 * The repository is trusted to return newest-first; the service owns clamping
 * and the [offset, offset + limit) window.
 */
@ExtendWith(MockitoExtension.class)
class DriverServiceTest {

    @Mock private DriverRepository driverRepository;
    @Mock private VehicleRepository vehicleRepository;
    @Mock private UserServiceClient userServiceClient;

    @InjectMocks private DriverService driverService;

    private Driver driver() {
        return new Driver(UUID.randomUUID(), UUID.randomUUID(), "LIC-" + UUID.randomUUID(), Instant.now());
    }

    @Test
    void defaultLimitIsTwentyWhenNonPositive() {
        when(driverRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of());
        when(driverRepository.count()).thenReturn(0L);

        PageResponse<DriverResponse> page = driverService.listDrivers(0, 0, null);

        assertThat(page.limit()).isEqualTo(20);
        assertThat(page.offset()).isZero();
    }

    @Test
    void limitIsClampedToHundred() {
        when(driverRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of());
        when(driverRepository.count()).thenReturn(0L);

        PageResponse<DriverResponse> page = driverService.listDrivers(500, 0, null);

        assertThat(page.limit()).isEqualTo(100);
    }

    @Test
    void unfilteredListUsesFindAllAndCount() {
        List<Driver> drivers = List.of(driver(), driver());
        when(driverRepository.findAllByOrderByCreatedAtDesc()).thenReturn(drivers);
        when(driverRepository.count()).thenReturn(2L);

        PageResponse<DriverResponse> page = driverService.listDrivers(20, 0, null);

        assertThat(page.items()).hasSize(2);
        assertThat(page.total()).isEqualTo(2L);
        verify(driverRepository).findAllByOrderByCreatedAtDesc();
        verify(driverRepository).count();
        verify(driverRepository, never()).findByStatusOrderByCreatedAtDesc(DriverStatus.ACTIVE);
    }

    @Test
    void statusFilteredListUsesFindByStatusAndCountByStatus() {
        List<Driver> drivers = List.of(driver());
        when(driverRepository.findByStatusOrderByCreatedAtDesc(DriverStatus.SUSPENDED)).thenReturn(drivers);
        when(driverRepository.countByStatus(DriverStatus.SUSPENDED)).thenReturn(1L);

        PageResponse<DriverResponse> page = driverService.listDrivers(20, 0, DriverStatus.SUSPENDED);

        assertThat(page.items()).hasSize(1);
        assertThat(page.total()).isEqualTo(1L);
        verify(driverRepository).findByStatusOrderByCreatedAtDesc(DriverStatus.SUSPENDED);
        verify(driverRepository).countByStatus(DriverStatus.SUSPENDED);
        verify(driverRepository, never()).findAllByOrderByCreatedAtDesc();
        verify(driverRepository, never()).count();
    }

    @Test
    void windowSlicesOffsetAndLimit() {
        Driver first = driver();
        Driver second = driver();
        Driver third = driver();
        when(driverRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(first, second, third));
        when(driverRepository.count()).thenReturn(3L);

        PageResponse<DriverResponse> page = driverService.listDrivers(1, 1, null);

        assertThat(page.items()).hasSize(1);
        assertThat(page.items().get(0).id()).isEqualTo(second.getId());
        assertThat(page.total()).isEqualTo(3L);
        assertThat(page.offset()).isEqualTo(1);
    }

    @Test
    void offsetPastEndYieldsEmptyPage() {
        when(driverRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(driver()));
        when(driverRepository.count()).thenReturn(1L);

        PageResponse<DriverResponse> page = driverService.listDrivers(20, 50, null);

        assertThat(page.items()).isEmpty();
        assertThat(page.total()).isEqualTo(1L);
    }

    @Test
    void newestFirstOrderComesFromRepository() {
        Driver newest = driver();
        Driver oldest = driver();
        when(driverRepository.findAllByOrderByCreatedAtDesc()).thenReturn(List.of(newest, oldest));
        when(driverRepository.count()).thenReturn(2L);

        PageResponse<DriverResponse> page = driverService.listDrivers(20, 0, null);

        assertThat(page.items().get(0).id()).isEqualTo(newest.getId());
        assertThat(page.items().get(1).id()).isEqualTo(oldest.getId());
    }
}
