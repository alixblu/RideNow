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
 */
public interface PaymentGateway {

    /**
     * Attempt to charge the given amount using the given method.
     *
     * @return the outcome of the charge; callers map this onto PaymentStatus.
     */
    ChargeResult charge(PaymentMethod method, BigDecimal amount, String currency);

    /**
     * Outcome of a charge attempt. A successful charge has {@code approved=true}
     * and a null {@code failureReason}; a declined charge carries a reason.
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
