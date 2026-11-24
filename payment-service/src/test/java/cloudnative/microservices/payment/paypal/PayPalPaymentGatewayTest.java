package cloudnative.microservices.payment.paypal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.gateway.PaymentGateway.ChargeResult;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class PayPalPaymentGatewayTest {

    private final PayPalProperties props = new PayPalProperties(
            "id", "secret", "http://paypal.test", "USD", new BigDecimal("25000"), new BigDecimal("1.25"));
    private PayPalClient client;
    private PayPalPaymentGateway gateway;

    @BeforeEach
    void setUp() {
        client = mock(PayPalClient.class);
        when(client.properties()).thenReturn(props);
        gateway = new PayPalPaymentGateway(client);
    }

    private static Map<String, Object> authorizedOrder(String status, String value) {
        return Map.of("purchase_units", List.of(Map.of("payments", Map.of("authorizations", List.of(
                Map.of("id", "AUTH-1", "status", status, "amount", Map.of("value", value)))))));
    }

    @Test
    void authorizeWithoutOrderIdIsDeclined() {
        ChargeResult result = gateway.authorize(PaymentMethod.PAYPAL, new BigDecimal("50000"), "VND", null);
        assertThat(result.approved()).isFalse();
    }

    @Test
    void authorizeApprovesAndReturnsAuthorizationId() {
        when(client.post(eq("/v2/checkout/orders/ORDER-1/authorize"), any(), isNull()))
                .thenReturn(authorizedOrder("CREATED", "2.50"));
        // 50,000 VND / 25,000 = 2.00 USD; the approved hold of 2.50 covers it.
        ChargeResult result = gateway.authorize(PaymentMethod.PAYPAL, new BigDecimal("50000"), "VND", "ORDER-1");
        assertThat(result.approved()).isTrue();
        assertThat(result.providerReference()).isEqualTo("AUTH-1");
    }

    @Test
    void authorizeDeclinesAndVoidsWhenHoldIsBelowFare() {
        when(client.post(eq("/v2/checkout/orders/ORDER-1/authorize"), any(), isNull()))
                .thenReturn(authorizedOrder("CREATED", "1.00"));
        ChargeResult result = gateway.authorize(PaymentMethod.PAYPAL, new BigDecimal("50000"), "VND", "ORDER-1");
        assertThat(result.approved()).isFalse();
        verify(client).post(eq("/v2/payments/authorizations/AUTH-1/void"), any(), isNull());
    }

    @Test
    void authorizeDeclinesWhenPayPalRejects() {
        when(client.post(any(), any(), any())).thenThrow(new PayPalException("PayPal rejected the request (HTTP 422)"));
        ChargeResult result = gateway.authorize(PaymentMethod.PAYPAL, new BigDecimal("50000"), "VND", "ORDER-1");
        assertThat(result.approved()).isFalse();
        assertThat(result.failureReason()).contains("422");
    }

    @Test
    void captureSendsConvertedAmountAsFinalCapture() {
        when(client.post(eq("/v2/payments/authorizations/AUTH-1/capture"), any(), any()))
                .thenReturn(Map.of("status", "COMPLETED"));
        ChargeResult result = gateway.capture(PaymentMethod.PAYPAL, new BigDecimal("50000"), "VND", "AUTH-1");
        assertThat(result.approved()).isTrue();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(client).post(eq("/v2/payments/authorizations/AUTH-1/capture"), eq("capture-AUTH-1"), body.capture());
        assertThat(body.getValue()).containsEntry("final_capture", true);
        assertThat(body.getValue().get("amount")).isEqualTo(Map.of("currency_code", "USD", "value", "2.00"));
    }

    @Test
    void releaseVoidsTheAuthorization() {
        gateway.release(PaymentMethod.PAYPAL, new BigDecimal("50000"), "VND", "AUTH-1");
        verify(client).post(eq("/v2/payments/authorizations/AUTH-1/void"), eq("void-AUTH-1"), isNull());
    }
}
