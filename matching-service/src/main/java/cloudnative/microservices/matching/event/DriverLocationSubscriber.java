package cloudnative.microservices.matching.event;

import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.service.DriverPositionService;
import java.math.BigDecimal;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Handles one message from driver-service's {@code ridenow:driver:locations}
 * channel: the position handoff that keeps matching's nearby-driver index current
 * for drivers who only post their location over HTTP.
 *
 * <ul>
 *   <li>{@code online=false} removes the driver;</li>
 *   <li>a position with a vehicle type is upserted;</li>
 *   <li>anything malformed is dropped (logged, never thrown).</li>
 * </ul>
 *
 * Pub/Sub is lossy, which is fine here: the latest position wins, and the next one
 * arrives a second or two later.
 */
@Component
public class DriverLocationSubscriber {

    private static final Logger log = LoggerFactory.getLogger(DriverLocationSubscriber.class);

    private static final BigDecimal MAX_LAT = BigDecimal.valueOf(90);
    private static final BigDecimal MAX_LNG = BigDecimal.valueOf(180);

    private final DriverPositionService positionService;
    private final ObjectMapper objectMapper;

    public DriverLocationSubscriber(DriverPositionService positionService, ObjectMapper objectMapper) {
        this.positionService = positionService;
        this.objectMapper = objectMapper;
    }

    public void onMessage(String json) {
        JsonNode update;
        try {
            update = objectMapper.readTree(json);
        } catch (RuntimeException e) {
            log.warn("Dropping an unreadable driver location message");
            return;
        }
        UUID driverId = uuid(update.path("driverId").asString(""));
        if (driverId == null) {
            log.warn("Dropping a driver location message without a valid driverId");
            return;
        }
        if (!update.path("online").asBoolean(true)) {
            positionService.removeDriver(driverId);
            return;
        }
        VehicleType vehicleType = vehicleType(update.path("vehicleType").asString(""));
        BigDecimal lat = coordinate(update.path("lat"), MAX_LAT);
        BigDecimal lng = coordinate(update.path("lng"), MAX_LNG);
        if (vehicleType == null || lat == null || lng == null) {
            log.warn("Dropping a location for driver {} without a valid vehicleType, lat and lng", driverId);
            return;
        }
        positionService.reportPosition(driverId, vehicleType, lat, lng);
    }

    private static BigDecimal coordinate(JsonNode node, BigDecimal max) {
        if (!node.isNumber()) {
            return null;
        }
        BigDecimal value = node.decimalValue();
        return value.abs().compareTo(max) > 0 ? null : value;
    }

    private static VehicleType vehicleType(String value) {
        try {
            return VehicleType.valueOf(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static UUID uuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
