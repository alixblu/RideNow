package cloudnative.microservices.trip.controller;

import cloudnative.microservices.trip.dto.response.TripOfferResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.service.TripService;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class TripController {

    private final TripService tripService;

    @GetMapping("/trips/{id}")
    public TripResponse getTrip(@PathVariable UUID id) {
        return tripService.getTrip(id);
    }

    @GetMapping("/trip-offers/{id}")
    public TripOfferResponse getTripOffer(@PathVariable UUID id) {
        return tripService.getTripOffer(id);
    }
}
