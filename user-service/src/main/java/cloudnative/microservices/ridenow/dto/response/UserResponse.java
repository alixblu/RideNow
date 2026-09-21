package cloudnative.microservices.ridenow.dto.response;

import cloudnative.microservices.ridenow.entity.UserStatus;
import java.time.Instant;
import java.util.UUID;

public record UserResponse(
        UUID id,
        String cognitoSub,
        String email,
        String phone,
        String fullName,
        String avatarUrl,
        UserStatus status,
        Instant createdAt,
        Instant updatedAt
) {
}
