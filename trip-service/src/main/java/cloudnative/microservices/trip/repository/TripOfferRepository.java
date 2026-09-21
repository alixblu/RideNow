package cloudnative.microservices.trip.repository;

import cloudnative.microservices.trip.entity.TripOffer;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TripOfferRepository extends JpaRepository<TripOffer, UUID> {
}
