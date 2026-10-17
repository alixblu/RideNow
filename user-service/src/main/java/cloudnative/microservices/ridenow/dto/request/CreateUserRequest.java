package cloudnative.microservices.ridenow.dto.request;

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