package cloudnative.microservices.driver.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import cloudnative.microservices.driver.dto.response.DriverLiveStateResponse;
import cloudnative.microservices.driver.entity.Vehicle;
import cloudnative.microservices.driver.entity.VehicleType;
import cloudnative.microservices.driver.exception.NoActiveVehicleException;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.live.Availability;
import cloudnative.microservices.driver.live.DriverLiveState;
import cloudnative.microservices.driver.live.DriverLocationStore;
import cloudnative.microservices.driver.live.LocationPublisher;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Live-state service rules with mocks: an unknown driver is rejected before any
 * Redis write, the vehicle is the picked one or else the newest active one, and
 * every position published carries its recorded time and vehicle type.
 */
@ExtendWith(MockitoExtension.class)
class DriverLiveServiceTest {

    @Mock private DriverRepository driverRepository;
    @Mock private VehicleRepository vehicleRepository;
    @Mock private DriverLocationStore locationStore;
    @Mock private LocationPublisher locationPublisher;
    @InjectMocks private DriverLiveService service;

    private final UUID driverId = UUID.randomUUID();

    private Vehicle vehicle(UUID owner, VehicleType type, boolean active) {
        Vehicle v = new Vehicle(UUID.randomUUID(), owner, "59A-" + UUID.randomUUID(), type,
                "Honda", "Wave", "red", Instant.now());
        ReflectionTestUtils.setField(v, "active", active);
        return v;
    }

    private DriverLiveState online(BigDecimal lat, BigDecimal lng, Instant at, VehicleType type) {
        return new DriverLiveState(driverId, Availability.ONLINE, lat, lng, at, type);
    }

    @Test
    void goOnlineWithoutAPickUsesTheNewestActiveVehicle() {
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(vehicleRepository.findFirstByDriverIdAndActiveTrueOrderByCreatedAtDesc(driverId))
                .thenReturn(Optional.of(vehicle(driverId, VehicleType.MOTORBIKE, true)));
        when(locationStore.getState(driverId)).thenReturn(Optional.of(
                online(null, null, Instant.now(), VehicleType.MOTORBIKE)));

        DriverLiveStateResponse response = service.goOnline(driverId, null);

        verify(locationStore).goOnline(driverId, VehicleType.MOTORBIKE);
        assertThat(response.availability()).isEqualTo(Availability.ONLINE);
        assertThat(response.vehicleType()).isEqualTo(VehicleType.MOTORBIKE);
    }

    @Test
    void goOnlineWithAPickedVehicleUsesIt() {
        Vehicle car = vehicle(driverId, VehicleType.CAR, true);
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(vehicleRepository.findById(car.getId())).thenReturn(Optional.of(car));
        when(locationStore.getState(driverId)).thenReturn(Optional.of(
                online(null, null, Instant.now(), VehicleType.CAR)));

        service.goOnline(driverId, car.getId());

        verify(locationStore).goOnline(driverId, VehicleType.CAR);
        verify(vehicleRepository, never()).findFirstByDriverIdAndActiveTrueOrderByCreatedAtDesc(any());
    }

    @Test
    void goOnlineWithNoActiveVehicleIsRefused() {
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(vehicleRepository.findFirstByDriverIdAndActiveTrueOrderByCreatedAtDesc(driverId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.goOnline(driverId, null))
                .isInstanceOf(NoActiveVehicleException.class);
        verifyNoInteractions(locationStore);
    }

    @Test
    void pickingAnInactiveVehicleIsRefused() {
        Vehicle old = vehicle(driverId, VehicleType.CAR, false);
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(vehicleRepository.findById(old.getId())).thenReturn(Optional.of(old));

        assertThatThrownBy(() -> service.goOnline(driverId, old.getId()))
                .isInstanceOf(NoActiveVehicleException.class);
        verifyNoInteractions(locationStore);
    }

    @Test
    void pickingAnotherDriversVehicleIsNotFound() {
        Vehicle theirs = vehicle(UUID.randomUUID(), VehicleType.CAR, true);
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(vehicleRepository.findById(theirs.getId())).thenReturn(Optional.of(theirs));

        assertThatThrownBy(() -> service.goOnline(driverId, theirs.getId()))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(locationStore);
    }

    @Test
    void goOnlineForUnknownDriverThrowsAndDoesNotTouchStore() {
        when(driverRepository.existsById(driverId)).thenReturn(false);

        assertThatThrownBy(() -> service.goOnline(driverId, null))
                .isInstanceOf(ResourceNotFoundException.class);
        verifyNoInteractions(locationStore);
    }

    @Test
    void updateLocationPublishesThePositionWithItsRecordedTimeAndVehicleType() {
        BigDecimal lat = new BigDecimal("10.5");
        BigDecimal lng = new BigDecimal("106.5");
        Instant stored = Instant.parse("2026-11-11T07:00:00Z");
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.of(online(lat, lng, stored, VehicleType.CAR)));

        DriverLiveStateResponse response = service.updateLocation(driverId, lat, lng);

        verify(locationStore).updateLocation(driverId, lat, lng);
        verify(locationPublisher).publish(driverId, lat, lng, stored, VehicleType.CAR);
        assertThat(response.lat()).isEqualByComparingTo("10.5");
        assertThat(response.recordedAt()).isEqualTo(stored);
    }

    @Test
    void anExpiredRecordGetsTheNewestActiveVehicleBack() {
        BigDecimal lat = new BigDecimal("10.5");
        BigDecimal lng = new BigDecimal("106.5");
        Instant stored = Instant.now();
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.of(online(lat, lng, stored, null)));
        when(vehicleRepository.findFirstByDriverIdAndActiveTrueOrderByCreatedAtDesc(driverId))
                .thenReturn(Optional.of(vehicle(driverId, VehicleType.MOTORBIKE, true)));

        DriverLiveStateResponse response = service.updateLocation(driverId, lat, lng);

        verify(locationStore).setVehicleType(driverId, VehicleType.MOTORBIKE);
        verify(locationPublisher).publish(driverId, lat, lng, stored, VehicleType.MOTORBIKE);
        assertThat(response.vehicleType()).isEqualTo(VehicleType.MOTORBIKE);
    }

    @Test
    void goOfflinePublishesTheOfflineMarker() {
        when(driverRepository.existsById(driverId)).thenReturn(true);

        service.goOffline(driverId);

        verify(locationStore).goOffline(driverId);
        verify(locationPublisher).publishOffline(eq(driverId), any(Instant.class));
    }

    @Test
    void aStateWithNoPositionHasNoRecordedAt() {
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.of(
                online(null, null, Instant.now(), VehicleType.CAR)));

        assertThat(service.getLiveState(driverId).recordedAt()).isNull();
    }

    @Test
    void getLiveStateWhenNotOnlineThrowsNotFound() {
        when(driverRepository.existsById(driverId)).thenReturn(true);
        when(locationStore.getState(driverId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getLiveState(driverId))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
