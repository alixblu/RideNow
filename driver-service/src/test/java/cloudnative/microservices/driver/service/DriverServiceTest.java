package cloudnative.microservices.driver.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.driver.client.UserServiceClient;
import cloudnative.microservices.driver.dto.request.CreateDriverRequest;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.exception.UpstreamUnavailableException;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Stage 4 service-to-service rules, verified with mocks (no running services).
 * createDriver must consult user-service BEFORE creating a driver.
 */
@ExtendWith(MockitoExtension.class)
class DriverServiceTest {

    @Mock private DriverRepository driverRepository;
    @Mock private VehicleRepository vehicleRepository;
    @Mock private UserServiceClient userServiceClient;

    @InjectMocks private DriverService driverService;

    @Test
    void createsDriverWhenUserExists() {
        UUID userId = UUID.randomUUID();
        CreateDriverRequest request = new CreateDriverRequest(userId, "LIC-100");
        when(userServiceClient.userExists(userId)).thenReturn(true);
        when(driverRepository.existsByUserId(userId)).thenReturn(false);
        when(driverRepository.existsByLicenseNumber("LIC-100")).thenReturn(false);
        when(driverRepository.save(any(Driver.class))).thenAnswer(inv -> inv.getArgument(0));

        var result = driverService.createDriver(request);

        assertThat(result.userId()).isEqualTo(userId);
        assertThat(result.licenseNumber()).isEqualTo("LIC-100");
        verify(driverRepository).save(any(Driver.class));
    }

    @Test
    void rejectsWhenUserDoesNotExist() {
        UUID userId = UUID.randomUUID();
        CreateDriverRequest request = new CreateDriverRequest(userId, "LIC-200");
        when(userServiceClient.userExists(userId)).thenReturn(false);

        assertThatThrownBy(() -> driverService.createDriver(request))
                .isInstanceOf(ResourceNotFoundException.class);

        // Must not have attempted to create anything.
        verify(driverRepository, never()).save(any(Driver.class));
    }

    @Test
    void propagatesWhenUserServiceUnavailable() {
        UUID userId = UUID.randomUUID();
        CreateDriverRequest request = new CreateDriverRequest(userId, "LIC-300");
        when(userServiceClient.userExists(userId))
                .thenThrow(new UpstreamUnavailableException("user-service is unavailable"));

        assertThatThrownBy(() -> driverService.createDriver(request))
                .isInstanceOf(UpstreamUnavailableException.class);

        verify(driverRepository, never()).save(any(Driver.class));
    }
}