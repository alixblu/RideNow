# Stage 4 - Service-to-service communication

Goal: driver-service needs a fact it does NOT own - does this `userId` refer to a real
user? It cannot read user-service's database (forbidden). So it must ASK user-service over
HTTP. This is where you feel a real microservice boundary.

Prerequisites: Stages 1-3 done. Both services run (driver on 8080, user on 8081), each with
its own database container up.

The rule being honored: cross-service data access happens through an explicit API call,
never a shared database or JPA join. driver-service stores `userId` as a scalar UUID and
calls user-service when it needs to validate or read that user.

---

## Step 4.1 - Decide the contract

When `POST /api/drivers` is called, driver-service will:
1. Call `GET http://localhost:8081/api/users/{userId}` on user-service.
2. If user-service returns 200 -> the user exists -> continue creating the driver.
3. If 404 -> reject driver creation with 400/404 (bad userId).
4. If user-service is unreachable/times out -> fail clearly (502/503), do NOT create the driver.

---

## Step 4.2 - Make the user-service URL configuration, not a hardcoded string

**Why:** the address of another service changes between laptop, Docker, and Kubernetes.
It must be configurable. Hardcoding `localhost:8081` would break the moment you containerize.

Add to driver-service `application.yaml`:

```yaml
services:
  user-service:
    base-url: http://localhost:8081
```

Create a typed config holder
`driver-service/.../config/UserServiceProperties.java`:

```java
package cloudnative.microservices.driver.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "services.user-service")
public record UserServiceProperties(String baseUrl) {
}
```

Enable it by adding to the application class:
`@ConfigurationPropertiesScan` (next to `@SpringBootApplication`).

---

## Step 4.3 - Add an HTTP client

Spring Boot 4 ships `RestClient`. Register one as a bean.

Create `driver-service/.../config/HttpClientConfig.java`:

```java
package cloudnative.microservices.driver.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

@Configuration
public class HttpClientConfig {

    @Bean
    public RestClient userServiceRestClient(UserServiceProperties props) {
        return RestClient.builder()
                .baseUrl(props.baseUrl())
                .build();
    }
}
```

---

## Step 4.4 - Add a client wrapper that handles the failure cases

Create `driver-service/.../client/UserServiceClient.java`:

```java
package cloudnative.microservices.driver.client;

import cloudnative.microservices.driver.exception.UpstreamUnavailableException;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class UserServiceClient {

    private final RestClient restClient;

    public UserServiceClient(RestClient userServiceRestClient) {
        this.restClient = userServiceRestClient;
    }

    /** Returns true if the user exists, false if user-service says 404. */
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
            // Network error, timeout, user-service down, 5xx, etc.
            throw new UpstreamUnavailableException("user-service is unavailable");
        }
    }
}
```

Create the exception `driver-service/.../exception/UpstreamUnavailableException.java`:

```java
package cloudnative.microservices.driver.exception;

public class UpstreamUnavailableException extends RuntimeException {
    public UpstreamUnavailableException(String message) { super(message); }
}
```

Map it to 503 in `GlobalExceptionHandler` (add a handler returning
`HttpStatus.SERVICE_UNAVAILABLE`).

---

## Step 4.5 - Call the client from DriverService.createDriver

Add the dependency and the check at the top of `createDriver`:

```java
    private final UserServiceClient userServiceClient; // add to the final fields

    // inside createDriver, before the uniqueness checks:
    if (!userServiceClient.userExists(request.userId())) {
        throw new ResourceNotFoundException("User", request.userId());
    }
```

Because the class uses `@RequiredArgsConstructor`, adding the `final` field is enough -
Spring injects it.

---

## Step 4.6 - Compile and run both services

```powershell
# terminal A - user-service
cd d:\GitRepo\RideNow\user-service
docker compose up -d
.\mvnw.cmd spring-boot:run

# terminal B - driver-service
cd d:\GitRepo\RideNow\driver-service
docker compose up -d
.\mvnw.cmd -q compile
.\mvnw.cmd spring-boot:run
```

---

## Step 4.7 - Verify the three paths

**Happy path** - create a user, then a driver referencing that real user:

```powershell
$u = Invoke-RestMethod -Uri "http://localhost:8081/api/users" -Method Post -ContentType "application/json" `
  -Body (@{ cognitoSub=("sub-"+(Get-Random)); email=("a"+(Get-Random)+"@test.com"); fullName="Rider" } | ConvertTo-Json)

$d = Invoke-RestMethod -Uri "http://localhost:8080/api/drivers" -Method Post -ContentType "application/json" `
  -Body (@{ userId=$u.id; licenseNumber=("LIC-"+(Get-Random)) } | ConvertTo-Json)
$d   # succeeds - driver-service asked user-service and the user existed
```

**Unknown user** - driver creation rejected because user-service returned 404:

```powershell
Invoke-RestMethod -Uri "http://localhost:8080/api/drivers" -Method Post -ContentType "application/json" `
  -Body (@{ userId="00000000-0000-0000-0000-000000000000"; licenseNumber=("LIC-"+(Get-Random)) } | ConvertTo-Json)
# expect 404 - the user does not exist
```

**user-service down** - stop user-service (Ctrl+C in terminal A), then retry the happy path:

```powershell
# expect 503 Service Unavailable - driver-service could not reach user-service,
# and it did NOT create a driver. Failing safely is the lesson.
```

---

## Step 4.8 - Reflect (write answers in your own words)

- Why is this an HTTP call and not a database join across services?
- What did driver-service do when user-service was down, and why is that correct?
- What would happen in production if user-service is slow but not down? (hint: timeouts,
  and a later resilience stage: retries, circuit breakers.)

---

## Definition of Done

- [ ] Creating a driver with a real userId succeeds via a call to user-service
- [ ] Creating a driver with an unknown userId is rejected (404)
- [ ] With user-service stopped, driver creation fails safely (503) and creates nothing
- [ ] The user-service URL is configuration, not a hardcoded literal
- [ ] You can explain why cross-service joins are forbidden

Mark Stage 4 `[x]` in `../LEARNING_PATH.md`. You have now built a real two-service system.
Next: Part 2 (containerization) - the bridge to AWS.