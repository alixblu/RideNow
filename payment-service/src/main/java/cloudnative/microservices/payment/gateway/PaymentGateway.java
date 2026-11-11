package cloudnative.microservices.payment.gateway;

import cloudnative.microservices.payment.entity.PaymentMethod;
import java.math.BigDecimal;

/**
 * The boundary between payment-service and whatever actually moves money.
 *
 * This is the swap seam described in ARCHITECTURE.md: business logic in
 * PaymentService talks only to this interface, never to a concrete provider.
 * Today the only implementation is {@link SimulatedPaymentGateway}. A real
 * provider (e.g. a PayPalPaymentGateway calling the PayPal REST API) would be
 * added as another implementation of this interface, with no change to
 * PaymentService, the controller, or the schema.
 *
 * The lifecycle is authorize-then-capture: funds are held for the estimated fare
 * when the trip is requested, then captured for the final fare (or released)
 * once the trip ends.
 */
public interface PaymentGateway {

    /** Hold funds for the estimated fare. A decline means the trip must not start. */
    ChargeResult authorize(PaymentMethod method, BigDecimal amount, String currency);

    /** Capture the final fare against a previous authorization. */
    ChargeResult capture(PaymentMethod method, BigDecimal amount, String currency);

    /** Give back a previous authorization (trip cancelled). */
    void release(PaymentMethod method, BigDecimal amount, String currency);

    /**
     * Outcome of an authorize/capture attempt. A success has {@code approved=true}
     * and a null {@code failureReason}; a declined attempt carries a reason.
     */
    record ChargeResult(boolean approved, String failureReason) {

        public static ChargeResult approve() {
            return new ChargeResult(true, null);
        }

        public static ChargeResult decline(String reason) {
            return new ChargeResult(false, reason);
        }
    }
}
