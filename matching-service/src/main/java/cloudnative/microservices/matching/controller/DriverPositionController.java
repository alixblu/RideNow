package cloudnative.microservices.matching.controller;

import cloudnative.microservices.matching.dto.request.ReportPositionRequest;
import cloudnative.microservices.matching.service.DriverPositionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The ingest endpoint for the driver-position handoff. driver-service calls this
 * when a driver reports a location; matching-service stores it in its own copy.
 * This is how positions cross the service boundary explicitly (never by reading
 * another service's store).
 */
@RestController
@RequestMapping("/api/matching/positions")
@RequiredArgsConstructor
public class DriverPositionController {

    private final DriverPositionService driverPositionService;

    @PostMapping
    public ResponseEntity<Void> reportPosition(@Valid @RequestBody ReportPositionRequest request) {
        driverPositionService.reportPosition(
                request.driverId(), request.vehicleType(), request.lat(), request.lng());
        return ResponseEntity.accepted().build();
    }
}
