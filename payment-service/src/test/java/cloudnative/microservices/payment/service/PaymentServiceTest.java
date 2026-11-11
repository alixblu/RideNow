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
    @Mock private org.springframework.context.ApplicationEventPublisher events;

    @InjectMocks private PaymentService paymentService;

    private CreatePaymentRequest request(UUID tripId, String key) {
        return new CreatePaymentRequest(tripId, new BigDecimal("45000.00"), "VND", PaymentMethod.CASH, key, null);
    }

    private Payment authorizedPayment(UUID tripId) {
        Payment payment = new Payment(UUID.randomUUID(), tripId, new BigDecimal("45000.00"),
                "VND", PaymentMethod.CASH, "idem-auth", Instant.now());
        payment.markProcessing(Instant.now());
        payment.markAuthorized(Instant.now());
        return payment;
    }

    @Test
    void firstCallCreatesAndAuthorizes() {
        UUID tripId = UUID.randomUUID();
        CreatePaymentRequest req = request(tripId, "idem-1");
        when(paymentRepository.findByIdempotencyKey("idem-1")).thenReturn(Optional.empty());
        when(paymentRepository.existsByTripId(tripId)).thenReturn(false);
        when(paymentGateway.authorize(any(), any(), anyString())).thenReturn(PaymentGateway.ChargeResult.approve());
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.createPayment(req);

        assertThat(result.tripId()).isEqualTo(tripId);
        assertThat(result.status()).isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(result.paidAt()).isNull();
        verify(paymentRepository).save(any(Payment.class));
        // Nothing was paid yet, so a successful hold announces nothing.
        verify(events, never()).publishEvent(any());
    }

    @Test
    void duplicateKeyReturnsOriginalWithoutAuthorizingAgain() {
        UUID tripId = UUID.randomUUID();
        Payment original = authorizedPayment(tripId);
        when(paymentRepository.findByIdempotencyKey("idem-1")).thenReturn(Optional.of(original));

        PaymentResponse result = paymentService.createPayment(request(tripId, "idem-1"));

        assertThat(result.id()).isEqualTo(original.getId());
        assertThat(result.status()).isEqualTo(PaymentStatus.AUTHORIZED);
        // No second hold, no second save, and no event on an idempotent replay.
        verify(paymentGateway, never()).authorize(any(), any(), anyString());
        verify(paymentRepository, never()).save(any(Payment.class));
        verify(events, never()).publishEvent(any());
    }

    @Test
    void gatewayDeclineMarksPaymentFailed() {
        UUID tripId = UUID.randomUUID();
        when(paymentRepository.findByIdempotencyKey("idem-2")).thenReturn(Optional.empty());
        when(paymentRepository.existsByTripId(tripId)).thenReturn(false);
        when(paymentGateway.authorize(any(), any(), anyString()))
                .thenReturn(PaymentGateway.ChargeResult.decline("Insufficient funds"));
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.createPayment(request(tripId, "idem-2"));

        assertThat(result.status()).isEqualTo(PaymentStatus.FAILED);
        assertThat(result.failureReason()).isEqualTo("Insufficient funds");
        assertThat(result.failedAt()).isNotNull();

        org.mockito.ArgumentCaptor<cloudnative.microservices.payment.event.DomainEvent> captor =
                org.mockito.ArgumentCaptor.forClass(cloudnative.microservices.payment.event.DomainEvent.class);
        verify(events).publishEvent(captor.capture());
        assertThat(captor.getValue().type())
                .isEqualTo(cloudnative.microservices.payment.event.PaymentEvents.PAYMENT_FAILED);
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
    void captureMovesAuthorizedToPaidWithFinalAmountAndAnnounces() {
        UUID tripId = UUID.randomUUID();
        UUID passengerId = UUID.randomUUID();
        Payment payment = authorizedPayment(tripId);
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.of(payment));
        when(paymentGateway.capture(any(), any(), anyString())).thenReturn(PaymentGateway.ChargeResult.approve());
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.capture(tripId, new BigDecimal("52000.00"), passengerId);

        assertThat(result.status()).isEqualTo(PaymentStatus.PAID);
        assertThat(result.amount()).isEqualByComparingTo("52000.00");
        assertThat(result.paidAt()).isNotNull();

        org.mockito.ArgumentCaptor<cloudnative.microservices.payment.event.DomainEvent> captor =
                org.mockito.ArgumentCaptor.forClass(cloudnative.microservices.payment.event.DomainEvent.class);
        verify(events).publishEvent(captor.capture());
        assertThat(captor.getValue().type())
                .isEqualTo(cloudnative.microservices.payment.event.PaymentEvents.PAYMENT_SUCCEEDED);
        assertThat(captor.getValue().data()).containsEntry("passengerId", passengerId.toString());
    }

    @Test
    void captureIsNoOpWhenAlreadyPaid() {
        UUID tripId = UUID.randomUUID();
        Payment payment = authorizedPayment(tripId);
        payment.markCaptured(new BigDecimal("45000.00"), Instant.now());
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.of(payment));

        PaymentResponse result = paymentService.capture(tripId, new BigDecimal("45000.00"), null);

        assertThat(result.status()).isEqualTo(PaymentStatus.PAID);
        // A duplicate delivery must not charge again, save, or re-announce.
        verify(paymentGateway, never()).capture(any(), any(), anyString());
        verify(paymentRepository, never()).save(any(Payment.class));
        verify(events, never()).publishEvent(any());
    }

    @Test
    void captureDeclineMarksFailedAndAnnouncesFailure() {
        UUID tripId = UUID.randomUUID();
        Payment payment = authorizedPayment(tripId);
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.of(payment));
        when(paymentGateway.capture(any(), any(), anyString()))
                .thenReturn(PaymentGateway.ChargeResult.decline("Card expired"));
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.capture(tripId, null, null);

        assertThat(result.status()).isEqualTo(PaymentStatus.FAILED);
        assertThat(result.failureReason()).isEqualTo("Card expired");

        org.mockito.ArgumentCaptor<cloudnative.microservices.payment.event.DomainEvent> captor =
                org.mockito.ArgumentCaptor.forClass(cloudnative.microservices.payment.event.DomainEvent.class);
        verify(events).publishEvent(captor.capture());
        assertThat(captor.getValue().type())
                .isEqualTo(cloudnative.microservices.payment.event.PaymentEvents.PAYMENT_FAILED);
    }

    @Test
    void captureForUnknownTripThrowsNotFound() {
        UUID tripId = UUID.randomUUID();
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> paymentService.capture(tripId, null, null))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void releaseMovesAuthorizedToReleased() {
        UUID tripId = UUID.randomUUID();
        Payment payment = authorizedPayment(tripId);
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.of(payment));
        when(paymentRepository.save(any(Payment.class))).thenAnswer(inv -> inv.getArgument(0));

        PaymentResponse result = paymentService.release(tripId);

        assertThat(result.status()).isEqualTo(PaymentStatus.RELEASED);
        verify(paymentGateway).release(any(), any(), anyString());
    }

    @Test
    void releaseIsNoOpWhenNotAuthorized() {
        UUID tripId = UUID.randomUUID();
        Payment payment = authorizedPayment(tripId);
        payment.markReleased(Instant.now());
        when(paymentRepository.findByTripId(tripId)).thenReturn(Optional.of(payment));

        PaymentResponse result = paymentService.release(tripId);

        assertThat(result.status()).isEqualTo(PaymentStatus.RELEASED);
        verify(paymentGateway, never()).release(any(), any(), anyString());
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
