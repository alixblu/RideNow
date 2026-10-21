package cloudnative.microservices.payment.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cloudnative.microservices.payment.dto.response.PaymentResponse;
import cloudnative.microservices.payment.entity.PaymentMethod;
import cloudnative.microservices.payment.entity.PaymentStatus;
import cloudnative.microservices.payment.exception.ResourceNotFoundException;
import cloudnative.microservices.payment.service.PaymentService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Web-slice test for the payment-lookup-by-trip endpoint. The service is mocked;
 * this verifies the HTTP boundary: query-param binding, status codes, and the
 * shared ApiErrorResponse shape for the error cases.
 */
@WebMvcTest(PaymentController.class)
class PaymentControllerTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private PaymentService paymentService;

    private PaymentResponse paidResponse(UUID tripId) {
        Instant now = Instant.now();
        return new PaymentResponse(
                UUID.randomUUID(), tripId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.CASH, PaymentStatus.PAID, "idem-1",
                null, now, now, now, null);
    }

    @Test
    void getPaymentForTripReturnsPayment() throws Exception {
        UUID tripId = UUID.randomUUID();
        PaymentResponse response = paidResponse(tripId);
        when(paymentService.getPaymentForTrip(eq(tripId))).thenReturn(response);

        mockMvc.perform(get("/api/payments").param("tripId", tripId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tripId").value(tripId.toString()))
                .andExpect(jsonPath("$.status").value("PAID"));
    }

    @Test
    void getPaymentForUnknownTripReturnsNotFound() throws Exception {
        UUID tripId = UUID.randomUUID();
        when(paymentService.getPaymentForTrip(eq(tripId)))
                .thenThrow(new ResourceNotFoundException("Payment for trip", tripId));

        mockMvc.perform(get("/api/payments").param("tripId", tripId.toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.path").value("/api/payments"));
    }

    @Test
    void getPaymentWithoutTripIdReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/payments"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }
}
