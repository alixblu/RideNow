package cloudnative.microservices.driver.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withResourceNotFound;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import cloudnative.microservices.driver.config.HttpClientConfig;
import cloudnative.microservices.driver.config.UserServiceProperties;
import cloudnative.microservices.driver.exception.UpstreamUnavailableException;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** The sync user lookup, against a mock user-service and against a real hung one. */
class UserServiceClientTest {

    private final UUID userId = UUID.randomUUID();
    private MockRestServiceServer server;
    private UserServiceClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl("http://user.test");
        server = MockRestServiceServer.bindTo(builder).build();
        client = new UserServiceClient(builder.build());
    }

    @Test
    void existingUserReturnsTrue() {
        server.expect(requestTo("http://user.test/api/users/" + userId))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess());

        assertThat(client.userExists(userId)).isTrue();
        server.verify();
    }

    @Test
    void notFoundReturnsFalse() {
        server.expect(requestTo("http://user.test/api/users/" + userId))
                .andRespond(withResourceNotFound());

        assertThat(client.userExists(userId)).isFalse();
    }

    @Test
    void serverErrorMeansUnavailable() {
        server.expect(requestTo("http://user.test/api/users/" + userId))
                .andRespond(withServerError());

        assertThatThrownBy(() -> client.userExists(userId))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    @Test
    void timeoutMeansUnavailable() {
        server.expect(requestTo("http://user.test/api/users/" + userId))
                .andRespond(withException(new SocketTimeoutException("Read timed out")));

        assertThatThrownBy(() -> client.userExists(userId))
                .isInstanceOf(UpstreamUnavailableException.class);
    }

    /** The configured read timeout really fires against a server that never answers. */
    @Test
    void hungUserServiceFailsFastWithUnavailable() throws IOException {
        CountDownLatch release = new CountDownLatch(1);
        HttpServer hung = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        hung.createContext("/", exchange -> {
            try {
                release.await();
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            exchange.close();
        });
        hung.start();
        try {
            UserServiceProperties props = new UserServiceProperties(
                    "http://127.0.0.1:" + hung.getAddress().getPort(),
                    Duration.ofMillis(500), Duration.ofMillis(300));
            UserServiceClient real = new UserServiceClient(new HttpClientConfig().userServiceRestClient(props));

            long start = System.nanoTime();
            assertThatThrownBy(() -> real.userExists(userId))
                    .isInstanceOf(UpstreamUnavailableException.class);
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(3));
        } finally {
            release.countDown();
            hung.stop(0);
        }
    }
}
