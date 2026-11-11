package cloudnative.microservices.trip.service;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.trip.entity.RideType;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class FareEstimatorTest {

    private final FareEstimator estimator = new FareEstimator();

    @Test
    void zeroDistanceCostsTheBaseFare() {
        BigDecimal pickup = new BigDecimal("10.762622");
        BigDecimal lng = new BigDecimal("106.660172");

        assertThat(estimator.estimate(RideType.MOTORBIKE, pickup, lng, pickup, lng))
                .isEqualByComparingTo("12000.00");
        assertThat(estimator.estimate(RideType.CAR, pickup, lng, pickup, lng))
                .isEqualByComparingTo("20000.00");
    }

    @Test
    void oneDegreeOfLatitudeIsAboutOneHundredElevenKilometres() {
        double km = FareEstimator.distanceKm(10.0, 106.0, 11.0, 106.0);

        assertThat(km).isBetween(110.5, 111.8);
    }

    @Test
    void carIsDearerThanMotorbikeOverTheSameDistance() {
        BigDecimal motorbike = estimator.estimate(RideType.MOTORBIKE,
                new BigDecimal("10.762622"), new BigDecimal("106.660172"),
                new BigDecimal("10.776889"), new BigDecimal("106.700806"));
        BigDecimal car = estimator.estimate(RideType.CAR,
                new BigDecimal("10.762622"), new BigDecimal("106.660172"),
                new BigDecimal("10.776889"), new BigDecimal("106.700806"));

        assertThat(car).isGreaterThan(motorbike);
        assertThat(motorbike).isGreaterThan(new BigDecimal("12000.00"));
        assertThat(car.scale()).isEqualTo(2);
    }
}
