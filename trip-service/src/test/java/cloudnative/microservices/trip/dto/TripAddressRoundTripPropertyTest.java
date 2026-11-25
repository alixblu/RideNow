package cloudnative.microservices.trip.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import cloudnative.microservices.trip.client.PaymentServiceClient;
import cloudnative.microservices.trip.dto.request.CreateTripRequest;
import cloudnative.microservices.trip.dto.request.PaymentMethod;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.Trip;
import cloudnative.microservices.trip.event.DomainEventPublisher;
import cloudnative.microservices.trip.repository.TripOfferRepository;
import cloudnative.microservices.trip.repository.TripRepository;
import cloudnative.microservices.trip.service.FareEstimator;
import cloudnative.microservices.trip.service.TripRecorder;
import cloudnative.microservices.trip.service.TripService;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.math.BigDecimal;
import java.util.Set;
import java.util.UUID;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.context.ApplicationEventPublisher;

/**
 * Feature: frontend-booking-and-password-login, Property 18: Trip addresses up to
 * 255 characters round-trip; longer addresses are rejected.
 *
 * <b>Validates: Requirements 6.8, 6.9</b>
 */
class TripAddressRoundTripPropertyTest {

    private static final Validator VALIDATOR =
            Validation.buildDefaultValidatorFactory().getValidator();

    @Provide
    Arbitrary<String> validAddresses() {
        return text(0, 255);
    }

    @Provide
    Arbitrary<String> tooLongAddresses() {
        return text(256, 600);
    }

    private static Arbitrary<String> text(int min, int max) {
        return Arbitraries.strings().withCharRange(' ', '\uD7FF').ofMinLength(min).ofMaxLength(max);
    }

    private static CreateTripRequest request(String pickup, String destination) {
        return new CreateTripRequest(
                UUID.randomUUID(), RideType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"),
                new BigDecimal("10.100000"), new BigDecimal("106.100000"),
                PaymentMethod.SIMULATED_CARD, null, pickup, destination);
    }

    @Property(tries = 100)
    void addressesUpTo255CharactersAreAcceptedAndRoundTrip(
            @ForAll("validAddresses") String pickup,
            @ForAll("validAddresses") String destination) {
        CreateTripRequest request = request(pickup, destination);
        assertThat(VALIDATOR.validate(request)).isEmpty();

        FareEstimator fareEstimator = mock(FareEstimator.class);
        TripRecorder recorder = mock(TripRecorder.class);
        when(fareEstimator.estimate(any(), any(), any(), any(), any()))
                .thenReturn(new BigDecimal("45000.00"));
        when(recorder.recordRequested(any(Trip.class))).thenAnswer(inv -> inv.getArgument(0));
        TripService service = new TripService(
                mock(TripRepository.class), mock(TripOfferRepository.class),
                mock(ApplicationEventPublisher.class), recorder, fareEstimator,
                mock(PaymentServiceClient.class), mock(DomainEventPublisher.class));

        TripResponse response = service.createTrip(request);

        assertThat(response.pickupAddress()).isEqualTo(pickup);
        assertThat(response.destinationAddress()).isEqualTo(destination);
    }

    @Property(tries = 100)
    void pickupAddressLongerThan255CharactersIsRejected(
            @ForAll("tooLongAddresses") String pickup,
            @ForAll("validAddresses") String destination) {
        Set<ConstraintViolation<CreateTripRequest>> violations =
                VALIDATOR.validate(request(pickup, destination));

        assertThat(violations).extracting(v -> v.getPropertyPath().toString())
                .containsExactly("pickupAddress");
    }

    @Property(tries = 100)
    void destinationAddressLongerThan255CharactersIsRejected(
            @ForAll("validAddresses") String pickup,
            @ForAll("tooLongAddresses") String destination) {
        Set<ConstraintViolation<CreateTripRequest>> violations =
                VALIDATOR.validate(request(pickup, destination));

        assertThat(violations).extracting(v -> v.getPropertyPath().toString())
                .containsExactly("destinationAddress");
    }
}
