package cloudnative.microservices.payment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "payments", indexes = @Index(name = "idx_payments_status", columnList = "status"))
@Getter
@NoArgsConstructor
public class Payment {

    @Id
    private UUID id;

    @Column(name = "trip_id", nullable = false, unique = true)
    private UUID tripId;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentMethod method;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PaymentStatus status;

    @Column(name = "idempotency_key", nullable = false, unique = true)
    private String idempotencyKey;

    @Column(name = "failure_reason")
    private String failureReason;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Column(name = "failed_at")
    private Instant failedAt;

    /**
     * Creates a brand-new payment in PENDING with server-owned defaults.
     * The service is the only caller; "how a payment is born" stays in one place.
     * Status transitions happen via markProcessing/markPaid/markFailed.
     */
    public Payment(UUID id, UUID tripId, BigDecimal amount, String currency,
                   PaymentMethod method, String idempotencyKey, Instant now) {
        this.id = id;
        this.tripId = tripId;
        this.amount = amount;
        this.currency = currency;
        this.method = method;
        this.status = PaymentStatus.PENDING;
        this.idempotencyKey = idempotencyKey;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** PENDING -> PROCESSING: the charge has been handed to the gateway. */
    public void markProcessing(Instant now) {
        this.status = PaymentStatus.PROCESSING;
        this.updatedAt = now;
    }

    /** PROCESSING -> PAID: the gateway approved the charge. */
    public void markPaid(Instant now) {
        this.status = PaymentStatus.PAID;
        this.failureReason = null;
        this.paidAt = now;
        this.updatedAt = now;
    }

    /** PROCESSING -> FAILED: the gateway declined; keep the reason for diagnostics. */
    public void markFailed(String reason, Instant now) {
        this.status = PaymentStatus.FAILED;
        this.failureReason = reason;
        this.failedAt = now;
        this.updatedAt = now;
    }
}
