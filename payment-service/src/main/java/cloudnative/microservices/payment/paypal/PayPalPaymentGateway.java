package cloudnative.microservices.payment.paypal;

import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.gateway.PaymentGateway;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Real PayPal implementation of {@link PaymentGateway} using the Orders v2 and
 * Payments v2 APIs.
 *
 * <ol>
 *   <li>The frontend creates an order ({@link PayPalOrderService}) and the rider approves it in PayPal.</li>
 *   <li>authorize: the approved order is authorized, which holds the funds and yields an authorization id.</li>
 *   <li>capture: that authorization is captured for the final fare (final capture, so the rest of the hold is freed).</li>
 *   <li>release: that authorization is voided.</li>
 * </ol>
 * Every call carries a PayPal-Request-Id derived from the order or authorization id, so a
 * retry cannot double-authorize or double-capture.
 */
@Component
public class PayPalPaymentGateway implements PaymentGateway {

    private static final Logger log = LoggerFactory.getLogger(PayPalPaymentGateway.class);

    private final PayPalClient client;

    public PayPalPaymentGateway(PayPalClient client) {
        this.client = client;
    }

    @Override
    public ChargeResult authorize(PaymentMethod method, BigDecimal amount, String currency, String providerOrderId) {
        if (providerOrderId == null || providerOrderId.isBlank()) {
            return ChargeResult.decline("A PayPal order approved by the rider is required");
        }
        try {
            BigDecimal required = PayPalAmounts.convert(client.properties(), amount, currency);
            Map<String, Object> order = client.post(
                    "/v2/checkout/orders/" + providerOrderId + "/authorize", "authorize-" + providerOrderId, null);
            Map<String, Object> authorization = firstAuthorization(order);
            if (authorization == null || !"CREATED".equals(authorization.get("status"))) {
                return ChargeResult.decline("PayPal did not authorize the payment");
            }
            String authorizationId = (String) authorization.get("id");
            BigDecimal held = new BigDecimal(String.valueOf(((Map<?, ?>) authorization.get("amount")).get("value")));
            if (held.compareTo(required) < 0) {
                // The approved order covers less than the fare; do not keep a hold that cannot pay for the ride.
                voidQuietly(authorizationId);
                return ChargeResult.decline("The approved PayPal amount is lower than the fare");
            }
            return ChargeResult.approve(authorizationId);
        } catch (PayPalException e) {
            return ChargeResult.decline(e.getMessage());
        }
    }

    @Override
    public ChargeResult capture(PaymentMethod method, BigDecimal amount, String currency, String providerReference) {
        if (providerReference == null) {
            return ChargeResult.decline("No PayPal authorization to capture");
        }
        try {
            BigDecimal value = PayPalAmounts.convert(client.properties(), amount, currency);
            Map<String, Object> body = Map.of(
                    "amount", Map.of("currency_code", client.properties().currency(), "value", plain(value)),
                    "final_capture", true);
            Map<String, Object> response = client.post(
                    "/v2/payments/authorizations/" + providerReference + "/capture",
                    "capture-" + providerReference, body);
            return "COMPLETED".equals(response.get("status"))
                    ? ChargeResult.approve(providerReference)
                    : ChargeResult.decline("PayPal capture was not completed (" + response.get("status") + ")");
        } catch (PayPalException e) {
            return ChargeResult.decline(e.getMessage());
        }
    }

    @Override
    public void release(PaymentMethod method, BigDecimal amount, String currency, String providerReference) {
        if (providerReference != null) {
            voidQuietly(providerReference);
        }
    }

    private void voidQuietly(String authorizationId) {
        try {
            client.post("/v2/payments/authorizations/" + authorizationId + "/void", "void-" + authorizationId, null);
        } catch (PayPalException e) {
            // An unvoided hold expires on its own; never fail the caller over it.
            log.error("Could not void PayPal authorization {}: {}", authorizationId, e.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> firstAuthorization(Map<String, Object> order) {
        if (!(order.get("purchase_units") instanceof List<?> units) || units.isEmpty()) {
            return null;
        }
        Object payments = ((Map<String, Object>) units.get(0)).get("payments");
        if (!(payments instanceof Map<?, ?> p) || !(p.get("authorizations") instanceof List<?> auths) || auths.isEmpty()) {
            return null;
        }
        return (Map<String, Object>) auths.get(0);
    }

    static String plain(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }
}
