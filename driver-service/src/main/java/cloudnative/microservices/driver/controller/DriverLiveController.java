package cloudnative.microservices.driver.controller;

import cloudnative.microservices.driver.dto.request.UpdateLocationRequest;
import cloudnative.microservices.driver.dto.response.DriverLiveStateResponse;
import cloudnative.microservices.driver.service.DriverLiveService;
import jakarta.validation.Valid;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Live driver-state endpoints (Redis-backed): go online/offline, report the
 * current position, and read the live state. Separate from DriverController to
 * keep the durable-profile API and the ephemeral live-state API distinct.
 */
@RestController
@RequestMapping("/api/drivers/{driverId}")
@RequiredArgsConstructor
public class DriverLiveController {

    private final DriverLiveService driverLiveService;

    @PostMapping("/online")
    public DriverLiveStateResponse goOnline(@PathVariable UUID driverId) {
        return driverLiveService.goOnline(driverId);
    }

    @PostMapping("/offline")
    public ResponseEntity<Void> goOffline(@PathVariable UUID driverId) {
        driverLiveService.goOffline(driverId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/location")
    public DriverLiveStateResponse updateLocation(
            @PathVariable UUID driverId, @Valid @RequestBody UpdateLocationRequest request) {
        return driverLiveService.updateLocation(driverId, request.lat(), request.lng());
    }

    @GetMapping("/live")
    public DriverLiveStateResponse getLiveState(@PathVariable UUID driverId) {
        return driverLiveService.getLiveState(driverId);
    }
}
