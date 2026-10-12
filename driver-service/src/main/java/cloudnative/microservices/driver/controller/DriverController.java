package cloudnative.microservices.driver.controller;

import cloudnative.microservices.driver.dto.request.CreateDriverRequest;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.VehicleResponse;
import cloudnative.microservices.driver.service.DriverService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class DriverController {

    private final DriverService driverService;

    @PostMapping("/drivers")
    public ResponseEntity<DriverResponse> createDriver(@Valid @RequestBody CreateDriverRequest request) {
        DriverResponse created = driverService.createDriver(request);
        // 201 Created + a Location header pointing at the new resource.
        return ResponseEntity
                .created(URI.create("/api/drivers/" + created.id()))
                .body(created);
    }

    @GetMapping("/drivers/{id}")
    public DriverResponse getDriver(@PathVariable UUID id) {
        return driverService.getDriver(id);
    }

    @GetMapping("/vehicles/{id}")
    public VehicleResponse getVehicle(@PathVariable UUID id) {
        return driverService.getVehicle(id);
    }
}
