package cloudnative.microservices.driver.controller;

import cloudnative.microservices.driver.dto.request.CreateDriverRequest;
import cloudnative.microservices.driver.dto.request.CreateVehicleRequest;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.VehicleResponse;
import cloudnative.microservices.driver.entity.DriverStatus;
import cloudnative.microservices.driver.service.DriverService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class DriverController {

    private final DriverService driverService;

    @PostMapping("/drivers")
    public ResponseEntity<DriverResponse> createDriver(@Valid @RequestBody CreateDriverRequest request) {
        DriverResponse created = driverService.createDriver(request);
        return ResponseEntity.created(URI.create("/api/drivers/" + created.id())).body(created);
    }

    @GetMapping("/drivers/{id}")
    public DriverResponse getDriver(@PathVariable UUID id) {
        return driverService.getDriver(id);
    }

    @PostMapping("/drivers/{driverId}/vehicles")
    public ResponseEntity<VehicleResponse> addVehicle(
            @PathVariable UUID driverId, @Valid @RequestBody CreateVehicleRequest request) {
        VehicleResponse created = driverService.addVehicle(driverId, request);
        return ResponseEntity.created(URI.create("/api/vehicles/" + created.id())).body(created);
    }

    @GetMapping("/drivers/{driverId}/vehicles")
    public List<VehicleResponse> listVehicles(@PathVariable UUID driverId) {
        return driverService.listVehicles(driverId);
    }

    @PatchMapping("/drivers/{driverId}/status")
    public DriverResponse changeStatus(@PathVariable UUID driverId, @RequestParam DriverStatus status) {
        return driverService.changeStatus(driverId, status);
    }

    @GetMapping("/vehicles/{id}")
    public VehicleResponse getVehicle(@PathVariable UUID id) {
        return driverService.getVehicle(id);
    }
}