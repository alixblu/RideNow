package cloudnative.microservices.payment.gateway;

import cloudnative.microservices.payment.entity.PaymentMethod;
import java.math.BigDecimal;
import org.springframework.stereotype.Component;

/**
 * Local, no-external-dependency implementation of {@link PaymentGateway}.
 *
 * It approves every authorize and capture. This is the "boring local mechanism"
 * for the payment boundary: it lets the whole authorize -> capture/release flow
 * and the idempotency guarantee be built and tested with no real provider, no
 * credentials, and no network. A real PayPalPaymentGateway swaps in later behind
 * the same interface.
 */
@Component
public class SimulatedPaymentGateway implements PaymentGateway {

    @Override
    public ChargeResult authorize(PaymentMethod method, BigDecimal amount, String currency) {
        // A real gateway would call out to a provider here. The simulated one
        // always approves, so the happy path is exercised end-to-end locally.
        return ChargeResult.approve();
    }

    @Override
    public ChargeResult capture(PaymentMethod method, BigDecimal amount, String currency) {
        return ChargeResult.approve();
    }

    @Override
    public void release(PaymentMethod method, BigDecimal amount, String currency) {
        // Nothing to give back in the simulation.
    }
}
