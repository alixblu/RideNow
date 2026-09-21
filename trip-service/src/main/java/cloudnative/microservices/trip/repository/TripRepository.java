package cloudnative.microservices.trip.repository;

import cloudnative.microservices.trip.entity.Trip;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TripRepository extends JpaRepository<Trip, UUID> {
}
