package cloudnative.microservices.payment.paypal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Endpoints the frontend needs to run the PayPal approval step. */
@RestController
@RequestMapping("/api/payments/paypal")
public class PayPalController {

    private final PayPalOrderService orders;
    private final PayPalProperties props;

    public PayPalController(PayPalOrderService orders, PayPalProperties props) {
        this.orders = orders;
        this.props = props;
    }

    /** Public values for loading the PayPal JS SDK. The client id is public; the secret never leaves the server. */
    @GetMapping("/config")
    public ResponseEntity<PayPalConfigResponse> config() {
        if (!props.configured()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        return ResponseEntity.ok(new PayPalConfigResponse(props.clientId(), props.currency()));
    }

    @PostMapping("/orders")
    public ResponseEntity<CreateOrderResponse> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        try {
            return ResponseEntity.status(HttpStatus.CREATED)
                    .body(new CreateOrderResponse(orders.createOrder(request.amount(), request.currency())));
        } catch (PayPalException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).build();
        }
    }

    public record PayPalConfigResponse(String clientId, String currency) {
    }

    public record CreateOrderRequest(
            @NotNull @DecimalMin(value = "0.0", inclusive = false) BigDecimal amount,
            @NotBlank @Size(min = 3, max = 3) String currency) {
    }

    public record CreateOrderResponse(String orderId) {
    }
}
