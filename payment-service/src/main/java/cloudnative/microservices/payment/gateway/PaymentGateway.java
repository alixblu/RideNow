package cloudnative.microservices.payment.gateway;

import cloudnative.microservices.payment.entity.PaymentMethod;
import java.math.BigDecimal;

/**
 * The boundary between payment-service and whatever actually moves money.
 *
 * This is the swap seam described in ARCHITECTURE.md: business logic in
 * PaymentService talks only to this interface, never to a concrete provider.
 * {@link RoutingPaymentGateway} is the bean the service receives; it sends
 * PAYPAL payments to the PayPal implementation and everything else to
 * {@link SimulatedPaymentGateway}.
 *
 * The lifecycle is authorize-then-capture: funds are held for the estimated fare
 * when the trip is requested, then captured for the final fare (or released)
 * once the trip ends. A provider can return a reference at authorization (for
 * PayPal, the authorization id); the service stores it and passes it back on
 * capture and release.
 */
public interface PaymentGateway {

    /**
     * Hold funds for the estimated fare. A decline means the trip must not start.
     *
     * @param providerOrderId provider-side order the buyer approved (PayPal order id); null for methods without one
     */
    ChargeResult authorize(PaymentMethod method, BigDecimal amount, String currency, String providerOrderId);

    /** Capture the final fare against a previous authorization ({@code providerReference} from authorize). */
    ChargeResult capture(PaymentMethod method, BigDecimal amount, String currency, String providerReference);

    /** Give back a previous authorization (trip cancelled). */
    void release(PaymentMethod method, BigDecimal amount, String currency, String providerReference);

    /**
     * Outcome of an authorize/capture attempt. A success has {@code approved=true}
     * and a null {@code failureReason}; a declined attempt carries a reason.
     * {@code providerReference} is the provider's id for the hold, or null.
     */
    record ChargeResult(boolean approved, String failureReason, String providerReference) {

        public static ChargeResult approve() {
            return new ChargeResult(true, null, null);
        }

        public static ChargeResult approve(String providerReference) {
            return new ChargeResult(true, null, providerReference);
        }

        public static ChargeResult decline(String reason) {
            return new ChargeResult(false, reason, null);
        }
    }
}
