package cloudnative.microservices.payment.paypal;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Creates the PayPal order the rider approves in the PayPal popup. The order has
 * intent AUTHORIZE, so approving it only holds funds; the money moves when the
 * trip completes. The amount is the fare converted to the PayPal currency, times
 * authorizationBuffer so the hold covers a final fare a little above the estimate.
 */
@Service
public class PayPalOrderService {

    private final PayPalClient client;

    public PayPalOrderService(PayPalClient client) {
        this.client = client;
    }

    public String createOrder(BigDecimal amount, String currency) {
        PayPalProperties props = client.properties();
        BigDecimal value = PayPalAmounts.convert(props, amount, currency)
                .multiply(props.authorizationBuffer());
        Map<String, Object> body = Map.of(
                "intent", "AUTHORIZE",
                "purchase_units", List.of(Map.of(
                        "amount", Map.of(
                                "currency_code", props.currency(),
                                "value", PayPalPaymentGateway.plain(value)))));
        Map<String, Object> response = client.post("/v2/checkout/orders", UUID.randomUUID().toString(), body);
        if (!(response.get("id") instanceof String id)) {
            throw new PayPalException("PayPal returned no order id");
        }
        return id;
    }
}
