package cloudnative.microservices.realtime.dto;

import java.util.UUID;

/** Who may watch whom: the passenger of a trip and the driver who accepted it. */
public record Pairing(UUID tripId, UUID passengerId, UUID driverId) {
}
