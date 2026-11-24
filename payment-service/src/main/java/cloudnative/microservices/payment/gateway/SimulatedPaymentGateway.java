package cloudnative.microservices.payment.gateway;

import cloudnative.microservices.payment.entity.PaymentMethod;
import java.math.BigDecimal;
import org.springframework.stereotype.Component;

/**
 * Local, no-external-dependency implementation of {@link PaymentGateway}.
 *
 * It approves every authorize and capture. It handles CASH and SIMULATED_CARD,
 * letting the whole authorize -> capture/release flow and the idempotency
 * guarantee be built and tested with no real provider, no credentials, and no
 * network. PAYPAL goes to the real PayPal gateway via {@link RoutingPaymentGateway}.
 */
@Component
public class SimulatedPaymentGateway implements PaymentGateway {

    @Override
    public ChargeResult authorize(PaymentMethod method, BigDecimal amount, String currency, String providerOrderId) {
        return ChargeResult.approve();
    }

    @Override
    public ChargeResult capture(PaymentMethod method, BigDecimal amount, String currency, String providerReference) {
        return ChargeResult.approve();
    }

    @Override
    public void release(PaymentMethod method, BigDecimal amount, String currency, String providerReference) {
        // Nothing to give back in the simulation.
    }
}
