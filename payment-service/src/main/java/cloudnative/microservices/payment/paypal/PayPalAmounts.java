package cloudnative.microservices.payment.paypal;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Converts a ride fare into the amount string PayPal expects. */
final class PayPalAmounts {

    private PayPalAmounts() {
    }

    /**
     * VND fares are divided by vndPerUnit (PayPal has no VND); a fare already in
     * the PayPal currency is used as is. Any other currency is rejected.
     */
    static BigDecimal convert(PayPalProperties props, BigDecimal amount, String currency) {
        if ("VND".equalsIgnoreCase(currency)) {
            return amount.divide(props.vndPerUnit(), 2, RoundingMode.HALF_UP);
        }
        if (props.currency().equalsIgnoreCase(currency)) {
            return amount.setScale(2, RoundingMode.HALF_UP);
        }
        throw new PayPalException("Unsupported currency for PayPal: " + currency);
    }
}
