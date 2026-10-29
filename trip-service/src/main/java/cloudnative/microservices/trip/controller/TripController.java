package cloudnative.microservices.trip.controller;

import cloudnative.microservices.trip.dto.request.CreateTripRequest;
import cloudnative.microservices.trip.dto.response.PageResponse;
import cloudnative.microservices.trip.dto.response.TripOfferResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.TripStatus;
import cloudnative.microservices.trip.service.TripService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Validated
public class TripController {

    private static final String DEFAULT_CANCELLATION_REASON = "Cancelled by rider";

    private final TripService tripService;

    @PostMapping("/trips")
    public ResponseEntity<TripResponse> createTrip(@Valid @RequestBody CreateTripRequest request) {
        TripResponse created = tripService.createTrip(request);
        return ResponseEntity.created(URI.create("/api/trips/" + created.id())).body(created);
    }

    // A driver attempts to accept (win) this trip.
    @PostMapping("/trips/{id}/accept")
    public TripResponse acceptTrip(@PathVariable UUID id, @RequestParam UUID driverId) {
        return tripService.acceptTrip(id, driverId);
    }

    // The assigned driver has arrived at the pickup point.
    @PostMapping("/trips/{id}/arrive")
    public TripResponse arriveTrip(@PathVariable UUID id) {
        return tripService.arriveTrip(id);
    }

    // The trip begins (passenger aboard).
    @PostMapping("/trips/{id}/start")
    public TripResponse startTrip(@PathVariable UUID id) {
        return tripService.startTrip(id);
    }

    // The trip is finished.
    @PostMapping("/trips/{id}/complete")
    public TripResponse completeTrip(@PathVariable UUID id) {
        return tripService.completeTrip(id);
    }

    @GetMapping("/trips")
    public PageResponse<TripResponse> listTrips(
            @RequestParam(required = false) UUID passengerId,
            @RequestParam(required = false) TripStatus status,
            @RequestParam(defaultValue = "20") @Min(0) int limit,
            @RequestParam(defaultValue = "0") @Min(0) int offset) {
        return tripService.listTrips(passengerId, status, limit, offset);
    }

    @GetMapping("/trips/{id}")
    public TripResponse getTrip(@PathVariable UUID id) {
        return tripService.getTrip(id);
    }

    // The rider cancels this trip.
    @PostMapping("/trips/{id}/cancel")
    public TripResponse cancelTrip(@PathVariable UUID id) {
        return tripService.cancelTrip(id, DEFAULT_CANCELLATION_REASON);
    }

    @GetMapping("/trip-offers/{id}")
    public TripOfferResponse getTripOffer(@PathVariable UUID id) {
        return tripService.getTripOffer(id);
    }
}