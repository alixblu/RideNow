package cloudnative.microservices.payment.repository;

import cloudnative.microservices.payment.entity.Payment;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentRepository extends JpaRepository<Payment, UUID> {

    /**
     * Idempotency lookup: a retried charge carries the same key, so we return the
     * original payment instead of creating a second one.
     */
    Optional<Payment> findByIdempotencyKey(String idempotencyKey);

    /**
     * Each trip has at most one payment (DBML: payments.trip_id is unique).
     * Used to reject a second charge for the same trip under a different key.
     */
    boolean existsByTripId(UUID tripId);
}
