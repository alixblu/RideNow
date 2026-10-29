package cloudnative.microservices.payment.service;

import cloudnative.microservices.payment.dto.request.CreatePaymentRequest;
import cloudnative.microservices.payment.dto.response.PaymentResponse;
import cloudnative.microservices.payment.entity.Payment;
import cloudnative.microservices.payment.exception.DuplicateResourceException;
import cloudnative.microservices.payment.exception.ResourceNotFoundException;
import cloudnative.microservices.payment.entity.PaymentStatus;
import cloudnative.microservices.payment.event.PaymentEvents;
import cloudnative.microservices.payment.gateway.PaymentGateway;
import cloudnative.microservices.payment.repository.PaymentRepository;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentRepository paymentRepository;
    private final PaymentGateway paymentGateway;
    private final ApplicationEventPublisher events;

    @Transactional(readOnly = true)
    public PaymentResponse getPayment(UUID id) {
        Payment payment = paymentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Payment", id));
        return toResponse(payment);
    }

    @Transactional(readOnly = true)
    public PaymentResponse getPaymentForTrip(UUID tripId) {
        Payment payment = paymentRepository.findByTripId(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Payment for trip", tripId));
        return toResponse(payment);
    }

    /**
     * Charge a trip, exactly once per idempotency key.
     *
     * Idempotency is the whole point: a client (or a retry after a timeout) may
     * send the same request more than once. The first call creates the payment
     * and runs it through the gateway; any later call carrying the same
     * idempotencyKey returns that original payment unchanged - no second charge.
     *
     * The payment moves PENDING -> PROCESSING -> PAID/FAILED. The gateway is the
     * swap seam: locally it is the SimulatedPaymentGateway; a real provider
     * (e.g. PayPal) implements the same interface with no change here.
     */
    @Transactional
    public PaymentResponse createPayment(CreatePaymentRequest request) {
        // Idempotency check first: a repeat of the same key returns the original.
        Optional<Payment> existing = paymentRepository.findByIdempotencyKey(request.idempotencyKey());
        if (existing.isPresent()) {
            return toResponse(existing.get());
        }

        // A trip has at most one payment (DBML: payments.trip_id is unique). A
        // second payment for the same trip under a DIFFERENT key is a conflict,
        // not an idempotent retry.
        if (paymentRepository.existsByTripId(request.tripId())) {
            throw new DuplicateResourceException(
                    "A payment already exists for trip " + request.tripId());
        }

        Instant now = Instant.now();
        Payment payment = new Payment(
                UUID.randomUUID(), request.tripId(), request.amount(), request.currency(),
                request.method(), request.idempotencyKey(), now);

        // PENDING -> PROCESSING: hand the charge to the gateway.
        payment.markProcessing(now);
        PaymentGateway.ChargeResult result =
                paymentGateway.charge(request.method(), request.amount(), request.currency());

        if (result.approved()) {
            payment.markPaid(Instant.now());
        } else {
            payment.markFailed(result.failureReason(), Instant.now());
        }

        Payment saved = paymentRepository.save(payment);

        // Announce the outcome so downstream consumers (notifications) can react.
        // Published after commit via the DomainEventListener; a failed publish
        // never undoes the committed payment.
        if (saved.getStatus() == PaymentStatus.PAID) {
            events.publishEvent(PaymentEvents.paymentSucceeded(saved));
        } else if (saved.getStatus() == PaymentStatus.FAILED) {
            events.publishEvent(PaymentEvents.paymentFailed(saved));
        }

        return toResponse(saved);
    }

    private PaymentResponse toResponse(Payment payment) {
        return new PaymentResponse(
                payment.getId(), payment.getTripId(), payment.getAmount(), payment.getCurrency(),
                payment.getMethod(), payment.getStatus(), payment.getIdempotencyKey(),
                payment.getFailureReason(), payment.getCreatedAt(), payment.getUpdatedAt(),
                payment.getPaidAt(), payment.getFailedAt()
        );
    }
}
