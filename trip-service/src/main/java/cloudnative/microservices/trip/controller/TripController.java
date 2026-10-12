package cloudnative.microservices.trip.controller;

import cloudnative.microservices.trip.dto.request.CreateTripRequest;
import cloudnative.microservices.trip.dto.response.TripOfferResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.service.TripService;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class TripController {

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

    @GetMapping("/trips/{id}")
    public TripResponse getTrip(@PathVariable UUID id) {
        return tripService.getTrip(id);
    }

    @GetMapping("/trip-offers/{id}")
    public TripOfferResponse getTripOffer(@PathVariable UUID id) {
        return tripService.getTripOffer(id);
    }
}