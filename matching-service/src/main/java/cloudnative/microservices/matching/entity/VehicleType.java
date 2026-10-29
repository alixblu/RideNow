package cloudnative.microservices.matching.entity;

/**
 * Ride/vehicle category. matching-service keeps its own copy of this enum (no
 * shared cross-service module); it matches the values used by driver-service and
 * trip-service by contract, not by a shared class.
 */
public enum VehicleType {
    MOTORBIKE,
    CAR
}
