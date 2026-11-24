package cloudnative.microservices.trip.client;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import cloudnative.microservices.trip.dto.request.PaymentMethod;
import cloudnative.microservices.trip.exception.PaymentDeclinedException;
import cloudnative.microservices.trip.exception.PaymentUnavailableException;
import java.math.BigDecimal;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseCreator;
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
        client.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND", PaymentMethod.SIMULATED_CARD, null);
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

    // ---- retries (a slow first request on a freshly started payment pod) -------

    private PaymentServiceClient retryingClient(RestClient.Builder builder) {
        return new PaymentServiceClient(builder.build(), 3, Duration.ZERO);
    }

    private static ResponseCreator timeout() {
        return request -> {
            throw new SocketTimeoutException("Read timed out");
        };
    }

    @Test
    void aTimeoutIsRetriedWithTheSameIdempotencyKey() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://payment.test");
        MockRestServiceServer retryServer = MockRestServiceServer.bindTo(builder).build();
        PaymentServiceClient retrying = retryingClient(builder);
        retryServer.expect(requestTo("http://payment.test/api/payments")).andRespond(timeout());
        retryServer.expect(requestTo("http://payment.test/api/payments"))
                .andExpect(jsonPath("$.idempotencyKey").value(tripId.toString()))
                .andRespond(withSuccess("{\"status\":\"AUTHORIZED\"}", MediaType.APPLICATION_JSON));

        assertThatCode(() -> retrying.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.SIMULATED_CARD, null)).doesNotThrowAnyException();
        retryServer.verify();
    }

    @Test
    void aRetryThatConflictsReadsThePaymentTheFirstAttemptStored() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://payment.test");
        MockRestServiceServer retryServer = MockRestServiceServer.bindTo(builder).build();
        PaymentServiceClient retrying = retryingClient(builder);
        retryServer.expect(requestTo("http://payment.test/api/payments")).andRespond(timeout());
        retryServer.expect(requestTo("http://payment.test/api/payments"))
                .andExpect(method(HttpMethod.POST))
                .andRespond(withStatus(HttpStatus.CONFLICT));
        retryServer.expect(requestTo("http://payment.test/api/payments?tripId=" + tripId))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"status\":\"AUTHORIZED\"}", MediaType.APPLICATION_JSON));

        assertThatCode(() -> retrying.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.SIMULATED_CARD, null)).doesNotThrowAnyException();
        retryServer.verify();
    }

    @Test
    void aDeclineFoundAfterAConflictIsStillADecline() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://payment.test");
        MockRestServiceServer retryServer = MockRestServiceServer.bindTo(builder).build();
        PaymentServiceClient retrying = retryingClient(builder);
        retryServer.expect(requestTo("http://payment.test/api/payments")).andRespond(withStatus(HttpStatus.CONFLICT));
        retryServer.expect(requestTo("http://payment.test/api/payments?tripId=" + tripId))
                .andRespond(withSuccess("{\"status\":\"FAILED\",\"failureReason\":\"Card declined\"}",
                        MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> retrying.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.SIMULATED_CARD, null))
                .isInstanceOf(PaymentDeclinedException.class).hasMessageContaining("Card declined");
    }

    @Test
    void timeoutsOnEveryAttemptMeanUnavailable() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://payment.test");
        MockRestServiceServer retryServer = MockRestServiceServer.bindTo(builder).build();
        PaymentServiceClient retrying = retryingClient(builder);
        for (int i = 0; i < 3; i++) {
            retryServer.expect(requestTo("http://payment.test/api/payments")).andRespond(timeout());
        }

        assertThatThrownBy(() -> retrying.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.SIMULATED_CARD, null)).isInstanceOf(PaymentUnavailableException.class);
        retryServer.verify();
    }

    @Test
    void aServerErrorIsNotRetried() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://payment.test");
        MockRestServiceServer retryServer = MockRestServiceServer.bindTo(builder).build();
        PaymentServiceClient retrying = retryingClient(builder);
        retryServer.expect(ExpectedCount.once(), requestTo("http://payment.test/api/payments"))
                .andRespond(withServerError());

        assertThatThrownBy(() -> retrying.authorize(tripId, passengerId, new BigDecimal("45000.00"), "VND",
                PaymentMethod.SIMULATED_CARD, null)).isInstanceOf(PaymentUnavailableException.class);
        retryServer.verify();
    }

    @Test
    void emptyBodyMeansUnavailable() {
        server.expect(requestTo("http://payment.test/api/payments"))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(this::authorize).isInstanceOf(PaymentUnavailableException.class);
    }
}
