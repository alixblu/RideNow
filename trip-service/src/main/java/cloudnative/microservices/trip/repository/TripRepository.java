package cloudnative.microservices.trip.repository;

import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.entity.TripStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TripRepository extends JpaRepository<Trip, UUID> {

    List<Trip> findAllByOrderByRequestedAtDesc();

    List<Trip> findByPassengerIdOrderByRequestedAtDesc(UUID passengerId);

    List<Trip> findByStatusOrderByRequestedAtDesc(TripStatus status);

    List<Trip> findByPassengerIdAndStatusOrderByRequestedAtDesc(UUID passengerId, TripStatus status);

    long countByPassengerId(UUID passengerId);

    long countByStatus(TripStatus status);

    long countByPassengerIdAndStatus(UUID passengerId, TripStatus status);
}
