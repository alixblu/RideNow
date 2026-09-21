package cloudnative.microservices.trip.entity;

public enum TripStatus {
    REQUESTED,
    SEARCHING,
    DRIVER_ASSIGNED,
    DRIVER_ARRIVED,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED
}
