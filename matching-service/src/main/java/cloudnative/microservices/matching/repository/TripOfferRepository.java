package cloudnative.microservices.matching.repository;

import cloudnative.microservices.matching.entity.TripOffer;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TripOfferRepository extends JpaRepository<TripOffer, UUID> {

    List<TripOffer> findByTripIdOrderByOfferedAtAsc(UUID tripId);

    /** Idempotency check for the event-driven path: a trip is matched at most once. */
    boolean existsByTripId(UUID tripId);
}
