package cloudnative.microservices.driver.client;

import cloudnative.microservices.driver.exception.UpstreamUnavailableException;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Talks to user-service over HTTP. driver-service does not own user data. */
@Component
public class UserServiceClient {

    private final RestClient restClient;

    public UserServiceClient(RestClient userServiceRestClient) {
        this.restClient = userServiceRestClient;
    }

    /** True if the user exists; false if user-service returns 404. */
    public boolean userExists(UUID userId) {
        try {
            restClient.get()
                    .uri("/api/users/{id}", userId)
                    .retrieve()
                    .toBodilessEntity();
            return true;
        } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
            return false;
        } catch (RestClientException e) {
            throw new UpstreamUnavailableException("user-service is unavailable");
        }
    }
}