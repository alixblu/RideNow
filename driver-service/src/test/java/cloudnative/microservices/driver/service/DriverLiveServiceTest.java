package cloudnative.microservices.driver.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cloudnative.microservices.driver.dto.response.DriverLiveStateResponse;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.live.Availability;
import cloudnative.microservices.driver.live.DriverLiveState;
import cloudnative.microservices.driver.live.DriverLocationStore;
import cloudnative.microservices.driver.repository.DriverRepository;
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
 * Live-state service rules with mocks: an unknown driver is rejected before any
 * Redis write, and valid calls delegate to the store and map to the response DTO.
 */
@ExtendWith(MockitoExtension.class)
class DriverLiveServiceTest {

    @Mock private DriverRepository driverRepository;
    @Mock private DriverLocationStore locationStore;
    @Mock private cloudnative.microservices.driver.live.LocationPublisher locationPublisher;

    @InjectMocks private DriverLiveService service;

    @Test
    void goOnlineForKnownDriverDelegatesToStore() {
        UUID driverId = UUID.randomUUID();
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.of(
                new DriverLiveState(driverId, Availability.ONLINE, null, null, Instant.now())));

        DriverLiveStateResponse response = service.goOnline(driverId);

        verify(locationStore).goOnline(driverId);
        assertThat(response.availability()).isEqualTo(Availability.ONLINE);
    }

    @Test
    void updateLocationForKnownDriverDelegatesToStore() {
        UUID driverId = UUID.randomUUID();
        BigDecimal lat = new BigDecimal("10.5");
        BigDecimal lng = new BigDecimal("106.5");
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.of(
                new DriverLiveState(driverId, Availability.ONLINE, lat, lng, Instant.now())));

        DriverLiveStateResponse response = service.updateLocation(driverId, lat, lng);

        verify(locationStore).updateLocation(driverId, lat, lng);
        assertThat(response.lat()).isEqualByComparingTo("10.5");
    }

    @Test
    void goOnlineForUnknownDriverThrowsAndDoesNotTouchStore() {
        UUID driverId = UUID.randomUUID();
        when(driverRepository.existsById(driverId)).thenReturn(false);

        assertThatThrownBy(() -> service.goOnline(driverId))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(locationStore);
    }

    @Test
    void getLiveStateWhenNotOnlineThrowsNotFound() {
        UUID driverId = UUID.randomUUID();
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getLiveState(driverId))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
