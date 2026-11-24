package cloudnative.microservices.payment.paypal;

import java.math.BigDecimal;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * PayPal REST settings. clientId/clientSecret come from a PayPal REST app
 * (env PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET). Blank credentials mean PayPal is
 * not configured and PAYPAL payments are declined.
 *
 * PayPal does not support VND, so fares (VND) are converted at vndPerUnit into
 * currency (default USD). authorizationBuffer multiplies the order amount so the
 * hold covers a final fare slightly above the estimate.
 */
@ConfigurationProperties("ridenow.paypal")
public record PayPalProperties(
        String clientId,
        String clientSecret,
        String baseUrl,
        String currency,
        BigDecimal vndPerUnit,
        BigDecimal authorizationBuffer
) {
    public boolean configured() {
        return clientId != null && !clientId.isBlank()
                && clientSecret != null && !clientSecret.isBlank();
    }
}
