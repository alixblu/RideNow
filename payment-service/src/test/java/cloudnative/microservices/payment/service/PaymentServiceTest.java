package cloudnative.microservices.payment.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.payment.dto.request.CreatePaymentRequest;
import cloudnative.microservices.payment.dto.response.PaymentResponse;
import cloudnative.microservices.payment.entity.Payment;
import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.entity.PaymentStatus;
import cloudnative.microservices.payment.exception.DuplicateResourceException;
import cloudnative.microservices.payment.exception.ResourceNotFoundException;
import cloudnative.microservices.payment.gateway.PaymentGateway;
import cloudnative.microservices.payment.repository.PaymentRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * Payment service rules, verified with mocks (no running DB or gateway).
 * The headline rule is idempotency: the same key never charges twice.
 */
@ExtendWith(MockitoExtension.class)
class PaymentServiceTest {

    @Mock private PaymentRepository paymentRepository;
    @Mock private PaymentGateway paymentGateway;

    @InjectMocks private PaymentService paymentService;

    private CreatePaymentRequest request(UUID tripId, String key) {
        return new CreatePaymentRequest(tripId, new BigDecimal("45000.00"), "VND", PaymentMethod.CASH, key);
    }

    @Test
    void firstCallCreatesAndChargesToPaid() {
        UUID tripId = UUID.randomUUID();
        CreatePaymentRequest req = request(tripId, "idem-1");
        when(paymentRepository.findByIdempotencyKey("idem-1")).thenReturn(Optional.empty());
        when(paymentRepository.existsByTripId(tripId)).thenReturn(false);
        when(paymentGateway.charge(any(), any(), anyString())).thenReturn(PaymentGateway.ChargeResult.approve());
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.createPayment(req);

        assertThat(result.tripId()).isEqualTo(tripId);
        assertThat(result.status()).isEqualTo(PaymentStatus.PAID);
        assertThat(result.paidAt()).isNotNull();
        verify(paymentRepository).save(any(Payment.class));
    }

    @Test
    void duplicateKeyReturnsOriginalWithoutChargingAgain() {
        UUID tripId = UUID.randomUUID();
        Payment original = new Payment(UUID.randomUUID(), tripId, new BigDecimal("45000.00"),
                "VND", PaymentMethod.CASH, "idem-1", Instant.now());
        original.markProcessing(Instant.now());
        original.markPaid(Instant.now());
        when(paymentRepository.findByIdempotencyKey("idem-1")).thenReturn(Optional.of(original));

        PaymentResponse result = paymentService.createPayment(request(tripId, "idem-1"));

        assertThat(result.id()).isEqualTo(original.getId());
        assertThat(result.status()).isEqualTo(PaymentStatus.PAID);
        // No second charge, no second save.
        verify(paymentGateway, never()).charge(any(), any(), anyString());
        verify(paymentRepository, never()).save(any(Payment.class));
    }

    @Test
    void gatewayDeclineMarksPaymentFailed() {
        UUID tripId = UUID.randomUUID();
        when(paymentRepository.findByIdempotencyKey("idem-2")).thenReturn(Optional.empty());
        when(paymentRepository.existsByTripId(tripId)).thenReturn(false);
        when(paymentGateway.charge(any(), any(), anyString()))
                .thenReturn(PaymentGateway.ChargeResult.decline("Insufficient funds"));
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.createPayment(request(tripId, "idem-2"));

        assertThat(result.status()).isEqualTo(PaymentStatus.FAILED);
        assertThat(result.failureReason()).isEqualTo("Insufficient funds");
        assertThat(result.failedAt()).isNotNull();
    }

    @Test
    void secondPaymentForSameTripUnderDifferentKeyIsRejected() {
        UUID tripId = UUID.randomUUID();
        when(paymentRepository.findByIdempotencyKey("idem-3")).thenReturn(Optional.empty());
        when(paymentRepository.existsByTripId(tripId)).thenReturn(true);

        assertThatThrownBy(() -> paymentService.createPayment(request(tripId, "idem-3")))
                .isInstanceOf(DuplicateResourceException.class);

        verify(paymentRepository, never()).save(any(Payment.class));
    }

    @Test
    void getUnknownPaymentThrowsNotFound() {
        UUID id = UUID.randomUUID();
        when(paymentRepository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> paymentService.getPayment(id))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void getPaymentForTripReturnsMappedResponse() {
        UUID tripId = UUID.randomUUID();
        Payment payment = new Payment(UUID.randomUUID(), tripId, new BigDecimal("45000.00"),
                "VND", PaymentMethod.CASH, "idem-4", Instant.now());
        payment.markProcessing(Instant.now());
        payment.markPaid(Instant.now());
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.of(payment));

        PaymentResponse result = paymentService.getPaymentForTrip(tripId);

        assertThat(result.id()).isEqualTo(payment.getId());
        assertThat(result.tripId()).isEqualTo(tripId);
        assertThat(result.status()).isEqualTo(PaymentStatus.PAID);
    }

    @Test
    void getPaymentForUnknownTripThrowsNotFound() {
        UUID tripId = UUID.randomUUID();
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> paymentService.getPaymentForTrip(tripId))
                .isInstanceOf(ResourceNotFoundException.class);
    }
}
