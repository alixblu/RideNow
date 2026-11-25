package cloudnative.microservices.ridenow.dto.request;

import cloudnative.microservices.ridenow.entity.AccountType;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @Email(message = "email must be valid") @NotBlank(message = "email is required") String email,
        @NotBlank(message = "password is required")
        @Size(min = 8, max = 72, message = "password must be 8 to 72 characters") String password,
        @NotBlank(message = "fullName is required") String fullName,
        @NotNull(message = "accountType is required") AccountType accountType
) {
}
