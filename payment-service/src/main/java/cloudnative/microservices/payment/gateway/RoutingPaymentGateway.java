package cloudnative.microservices.payment.gateway;

import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.paypal.PayPalPaymentGateway;
import java.math.BigDecimal;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/** The {@link PaymentGateway} the service uses: PAYPAL goes to PayPal, the rest to the simulator. */
@Component
@Primary
public class RoutingPaymentGateway implements PaymentGateway {

    private final SimulatedPaymentGateway simulated;
    private final PayPalPaymentGateway paypal;

    public RoutingPaymentGateway(SimulatedPaymentGateway simulated, PayPalPaymentGateway paypal) {
        this.simulated = simulated;
        this.paypal = paypal;
    }

    @Override
    public ChargeResult authorize(PaymentMethod method, BigDecimal amount, String currency, String providerOrderId) {
        return pick(method).authorize(method, amount, currency, providerOrderId);
    }

    @Override
    public ChargeResult capture(PaymentMethod method, BigDecimal amount, String currency, String providerReference) {
        return pick(method).capture(method, amount, currency, providerReference);
    }

    @Override
    public void release(PaymentMethod method, BigDecimal amount, String currency, String providerReference) {
        pick(method).release(method, amount, currency, providerReference);
    }

    private PaymentGateway pick(PaymentMethod method) {
        return method == PaymentMethod.PAYPAL ? paypal : simulated;
    }
}
