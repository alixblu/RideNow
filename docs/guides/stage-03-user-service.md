# Stage 3 - A second service (user-service)

Goal: build user-service from its empty Spring Initializr shell up to the same running
state as driver-service. Repeating the Stage 1 pattern on a fresh service is the point -
it turns the structure into muscle memory and proves services are independent.

Prerequisites: Stage 1 done. driver-service works. `user-service` currently has only a
`pom.xml` and the generated application class.

Key independence facts you will prove:
- user-service gets its OWN database (different host port: 5434)
- user-service runs on its OWN server port (8081)
- it can start and stop without driver-service

---

## Step 3.1 - Inspect what Spring Initializr already gave you

```powershell
cd d:\GitRepo\RideNow\user-service
.\mvnw.cmd -version
```

Open `pom.xml` and confirm the Java version and Spring Boot version. Do NOT change them -
AGENTS.md says preserve the generated configuration. Find the main application class under
`src/main/java/cloudnative/microservices/user/` - note the exact root package.

---

## Step 3.2 - Create the layered package folders

Under `src/main/java/cloudnative/microservices/user/` create these folders:
`controller`, `dto/request`, `dto/response`, `service`, `repository`, `entity`, `exception`.

```powershell
cd d:\GitRepo\RideNow\user-service\src\main\java\cloudnative\microservices\user
mkdir controller, service, repository, entity, exception
mkdir dto\request, dto\response
```

---

## Step 3.3 - Model the User entity from the DBML

**Why:** the `users` table in `docs/database/ridenow.dbml` is the source of truth. Match
its columns. Note `cognito_sub` (external auth id) and the `status` field.

Create `entity/UserStatus.java`:

```java
package cloudnative.microservices.user.entity;

public enum UserStatus {
    ACTIVE,
    SUSPENDED
}
```

Create `entity/User.java` (mirror the driver-service style - `@Getter`,
`@NoArgsConstructor`, explicit creation constructor):

```java
package cloudnative.microservices.user.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor
public class User {

    @Id
    private UUID id;

    @Column(name = "cognito_sub", nullable = false, unique = true)
    private String cognitoSub;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(unique = true)
    private String phone;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public User(UUID id, String cognitoSub, String email, String phone,
                String fullName, String avatarUrl, Instant now) {
        this.id = id;
        this.cognitoSub = cognitoSub;
        this.email = email;
        this.phone = phone;
        this.fullName = fullName;
        this.avatarUrl = avatarUrl;
        this.status = UserStatus.ACTIVE;
        this.createdAt = now;
        this.updatedAt = now;
    }
}
```

Note on `cognito_sub`: the DBML keeps it for when AWS Cognito is the identity provider.
For now, until Cognito exists, you can let the client send a placeholder or generate one.
A later security stage replaces this with a real Cognito subject id.

---

## Step 3.4 - DTOs (request + response)

`dto/request/CreateUserRequest.java`:

```java
package cloudnative.microservices.user.dto.request;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public record CreateUserRequest(
        @NotBlank(message = "cognitoSub is required") String cognitoSub,
        @Email(message = "email must be valid") @NotBlank(message = "email is required") String email,
        String phone,
        @NotBlank(message = "fullName is required") String fullName,
        String avatarUrl
) {
}
```

`dto/response/UserResponse.java`:

```java
package cloudnative.microservices.user.dto.response;

import cloudnative.microservices.user.entity.UserStatus;
import java.time.Instant;
import java.util.UUID;

public record UserResponse(
        UUID id, String email, String phone, String fullName,
        String avatarUrl, UserStatus status, Instant createdAt, Instant updatedAt
) {
}
```

Note: `UserResponse` deliberately omits `cognitoSub` - internal auth detail, not for API clients.

---

## Step 3.5 - Exceptions (copy the driver-service shapes)

Create `exception/ResourceNotFoundException.java`, `exception/DuplicateResourceException.java`,
`exception/ApiErrorResponse.java`, and `exception/GlobalExceptionHandler.java`, matching the
driver-service versions but with the `...user.exception` package. (Reuse the same code; only
the package line changes.)

---

## Step 3.6 - Repository

`repository/UserRepository.java`:

```java
package cloudnative.microservices.user.repository;

import cloudnative.microservices.user.entity.User;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {
    boolean existsByEmail(String email);
    boolean existsByCognitoSub(String cognitoSub);
}
```

---

## Step 3.7 - Service

`service/UserService.java`:

```java
package cloudnative.microservices.user.service;

import cloudnative.microservices.user.dto.request.CreateUserRequest;
import cloudnative.microservices.user.dto.response.UserResponse;
import cloudnative.microservices.user.entity.User;
import cloudnative.microservices.user.exception.DuplicateResourceException;
import cloudnative.microservices.user.exception.ResourceNotFoundException;
import cloudnative.microservices.user.repository.UserRepository;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    @Transactional
    public UserResponse createUser(CreateUserRequest request) {
        if (userRepository.existsByEmail(request.email())) {
            throw new DuplicateResourceException("Email already registered: " + request.email());
        }
        if (userRepository.existsByCognitoSub(request.cognitoSub())) {
            throw new DuplicateResourceException("Identity already registered");
        }
        User user = new User(UUID.randomUUID(), request.cognitoSub(), request.email(),
                request.phone(), request.fullName(), request.avatarUrl(), Instant.now());
        return toResponse(userRepository.save(user));
    }

    @Transactional(readOnly = true)
    public UserResponse getUser(UUID id) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        return toResponse(user);
    }

    private UserResponse toResponse(User u) {
        return new UserResponse(u.getId(), u.getEmail(), u.getPhone(), u.getFullName(),
                u.getAvatarUrl(), u.getStatus(), u.getCreatedAt(), u.getUpdatedAt());
    }
}
```

---

## Step 3.8 - Controller

`controller/UserController.java`:

```java
package cloudnative.microservices.user.controller;

import cloudnative.microservices.user.dto.request.CreateUserRequest;
import cloudnative.microservices.user.dto.response.UserResponse;
import cloudnative.microservices.user.service.UserService;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;

    @PostMapping("/users")
    public ResponseEntity<UserResponse> create(@Valid @RequestBody CreateUserRequest request) {
        UserResponse created = userService.createUser(request);
        return ResponseEntity.created(URI.create("/api/users/" + created.id())).body(created);
    }

    @GetMapping("/users/{id}")
    public UserResponse get(@PathVariable UUID id) {
        return userService.getUser(id);
    }
}
```

---

## Step 3.9 - Give user-service its OWN database

Create `user-service/docker-compose.yml` (note the DIFFERENT host port 5434):

```yaml
services:
  user-db:
    image: postgres:17
    container_name: user-db
    environment:
      POSTGRES_DB: user_service
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: user_local
    ports:
      - "5434:5432"
    volumes:
      - user-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_user -d user_service"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  user-db-data:
```

Start it:

```powershell
cd d:\GitRepo\RideNow\user-service
docker compose up -d
docker compose ps
```

---

## Step 3.10 - Wire application.yaml (DIFFERENT server + DB port)

Edit `user-service/src/main/resources/application.yaml` (or `.properties`):

```yaml
server:
  port: 8081

spring:
  application:
    name: user-service
  datasource:
    url: jdbc:postgresql://localhost:5434/user_service
    username: app_user
    password: user_local
  jpa:
    hibernate:
      ddl-auto: update
    show-sql: true

management:
  endpoints:
    web:
      exposure:
        include: health
```

The port 8081 is what lets user-service and driver-service (8080) run at the same time.

---

## Step 3.11 - Compile, run, verify

```powershell
cd d:\GitRepo\RideNow\user-service
.\mvnw.cmd -q compile
.\mvnw.cmd spring-boot:run
```

In another terminal:

```powershell
$u = Invoke-RestMethod -Uri "http://localhost:8081/api/users" -Method Post -ContentType "application/json" `
  -Body (@{ cognitoSub=("sub-"+(Get-Random)); email=("a"+(Get-Random)+"@test.com"); fullName="Test Rider" } | ConvertTo-Json)
$u
Invoke-RestMethod -Uri "http://localhost:8081/api/users/$($u.id)"
docker exec user-db psql -U app_user -d user_service -c "SELECT email, full_name, status FROM users;"
```

---

## Step 3.12 - Prove independence

With user-service running, start driver-service too (its DB container must also be up):

```powershell
# terminal A: user-service on 8081 (already running)
# terminal B:
cd d:\GitRepo\RideNow\driver-service
docker compose up -d
.\mvnw.cmd spring-boot:run   # driver-service on 8080
```

Both respond on their own ports. Stop user-service (Ctrl+C) and confirm driver-service
still works. That is service independence.

---

## Definition of Done

- [ ] user-service has the full layered structure and its own database on port 5434
- [ ] It runs on port 8081 and completes a create/read loop for users
- [ ] user-service and driver-service run at the same time, each independently startable
- [ ] You can explain why they do NOT share a database

Mark Stage 3 `[x]` in `../LEARNING_PATH.md` when done, then go to Stage 4.