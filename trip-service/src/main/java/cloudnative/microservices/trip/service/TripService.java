package cloudnative.microservices.trip.service;

import cloudnative.microservices.trip.dto.response.TripOfferResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.entity.TripOffer;
import cloudnative.microservices.trip.exception.ResourceNotFoundException;
import cloudnative.microservices.trip.repository.TripOfferRepository;
import cloudnative.microservices.trip.repository.TripRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class TripService {

    private final TripRepository tripRepository;
    private final TripOfferRepository tripOfferRepository;

    public TripResponse getTrip(UUID id) {
        Trip trip = tripRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Trip", id));
        return new TripResponse(
                trip.getId(), trip.getPassengerId(), trip.getDriverId(), trip.getVehicleId(), trip.getRideType(),
                trip.getPickupLat(), trip.getPickupLng(), trip.getPickupAddress(),
                trip.getDestinationLat(), trip.getDestinationLng(), trip.getDestinationAddress(), trip.getStatus(),
                trip.getEstimatedFare(), trip.getFinalFare(), trip.getCancellationReason(), trip.getVersion(),
                trip.getRequestedAt(), trip.getAcceptedAt(), trip.getArrivedAt(), trip.getStartedAt(),
                trip.getCompletedAt(), trip.getCancelledAt(), trip.getCreatedAt(), trip.getUpdatedAt()
        );
    }

    public TripOfferResponse getTripOffer(UUID id) {
        TripOffer tripOffer = tripOfferRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Trip offer", id));
        return new TripOfferResponse(
                tripOffer.getId(), tripOffer.getTripId(), tripOffer.getDriverId(), tripOffer.getStatus(),
                tripOffer.getDistanceMeters(), tripOffer.getOfferedAt(), tripOffer.getRespondedAt(),
                tripOffer.getExpiresAt()
        );
    }
}
