package cloudnative.microservices.trip.client;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import cloudnative.microservices.trip.dto.request.PaymentMethod;
import cloudnative.microservices.trip.exception.PaymentDeclinedException;
import cloudnative.microservices.trip.exception.PaymentUnavailableException;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** The sync authorize call, against a mock payment-service (no network). */
class PaymentServiceClientTest {

    private MockRestServiceServer server;
    private PaymentServiceClient client;

    private final UUID tripId = UUID.randomUUID();
    private final UUID passengerId = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://payment.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new PaymentServiceClient(builder.build());
    }

    private void authorize() {
        client.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND", PaymentMethod.SIMULATED_CARD);
    }

    @Test
    void authorizedResponseSucceedsAndUsesTripIdAsIdempotencyKey() {
        server.expect(requestTo("http://payment.test/api/payments"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.tripId").value(tripId.toString()))
                .andExpect(jsonPath("$.idempotencyKey").value(tripId.toString()))
                .andExpect(jsonPath("$.passengerId").value(passengerId.toString()))
                .andExpect(jsonPath("$.method").value("SIMULATED_CARD"))
                .andRespond(withSuccess("{\"status\":\"AUTHORIZED\"}", MediaType.APPLICATION_JSON));

        assertThatCode(this::authorize).doesNotThrowAnyException();
        server.verify();
    }

    @Test
    void failedStatusIsADecline() {
        server.expect(requestTo("http://payment.test/api/payments"))
                .andRespond(withSuccess(
                        "{\"status\":\"FAILED\",\"failureReason\":\"Insufficient funds\"}",
                        MediaType.APPLICATION_JSON));

        assertThatThrownBy(this::authorize)
                .isInstanceOf(PaymentDeclinedException.class)
                .hasMessageContaining("Insufficient funds");
    }

    @Test
    void serverErrorMeansUnavailable() {
        server.expect(requestTo("http://payment.test/api/payments")).andRespond(withServerError());

        assertThatThrownBy(this::authorize).isInstanceOf(PaymentUnavailableException.class);
    }

    @Test
    void emptyBodyMeansUnavailable() {
        server.expect(requestTo("http://payment.test/api/payments"))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(this::authorize).isInstanceOf(PaymentUnavailableException.class);
    }
}
