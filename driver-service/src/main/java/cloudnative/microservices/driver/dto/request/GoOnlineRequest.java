package cloudnative.microservices.driver.dto.request;

import java.util.UUID;

/**
 * Optional body of {@code POST /api/drivers/{id}/online}. Without a
 * {@code vehicleId} the driver goes online with their newest active vehicle.
 */
public record GoOnlineRequest(UUID vehicleId) {
}
