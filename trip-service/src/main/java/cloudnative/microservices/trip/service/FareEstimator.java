package cloudnative.microservices.trip.service;

import cloudnative.microservices.trip.entity.RideType;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.springframework.stereotype.Component;

/**
 * Estimates a fare from the straight-line (haversine) distance between pickup and
 * destination: {@code base + perKm * km}, in VND. Deliberately simple: no traffic,
 * surge, or routing. The estimate is what gets authorized up front and, for now,
 * also what is captured as the final fare.
 */
@Component
public class FareEstimator {

    public static final String CURRENCY = "VND";

    private static final double EARTH_RADIUS_KM = 6371.0088;

    public BigDecimal estimate(RideType rideType, BigDecimal pickupLat, BigDecimal pickupLng,
                               BigDecimal destinationLat, BigDecimal destinationLng) {
        double km = distanceKm(
                pickupLat.doubleValue(), pickupLng.doubleValue(),
                destinationLat.doubleValue(), destinationLng.doubleValue());

        long base;
        long perKm;
        switch (rideType) {
            case MOTORBIKE -> { base = 12_000; perKm = 4_500; }
            case CAR -> { base = 20_000; perKm = 11_000; }
            default -> throw new IllegalArgumentException("Unsupported ride type: " + rideType);
        }
        return BigDecimal.valueOf(base)
                .add(BigDecimal.valueOf(perKm).multiply(BigDecimal.valueOf(km)))
                .setScale(2, RoundingMode.HALF_UP);
    }

    static double distanceKm(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
    }
}
