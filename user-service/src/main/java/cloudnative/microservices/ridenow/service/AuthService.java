package cloudnative.microservices.ridenow.service;

import cloudnative.microservices.ridenow.dto.request.LoginRequest;
import cloudnative.microservices.ridenow.dto.request.RegisterRequest;
import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.entity.UserStatus;
import cloudnative.microservices.ridenow.exception.AccountSuspendedException;
import cloudnative.microservices.ridenow.exception.AuthenticationFailedException;
import cloudnative.microservices.ridenow.exception.DuplicateResourceException;
import cloudnative.microservices.ridenow.repository.UserRepository;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Password registration and login. Passwords and hashes are never logged or returned. */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public AuthService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional
    public UserResponse register(RegisterRequest request) {
        String email = request.email().trim();
        if (userRepository.findByEmailIgnoreCase(email).isPresent()) {
            log.info("Registration rejected: email already registered");
            throw new DuplicateResourceException("Email already registered: " + email);
        }
        User user = new User(UUID.randomUUID(), email, request.fullName().trim(),
                passwordEncoder.encode(request.password()), request.accountType(), Instant.now());
        User saved = userRepository.save(user);
        log.info("Registered account {} ({})", saved.getId(), saved.getAccountType());
        return toResponse(saved);
    }

    @Transactional(readOnly = true)
    public UserResponse login(LoginRequest request) {
        User user = userRepository.findByEmailIgnoreCase(request.email().trim())
                .orElseThrow(() -> failed("unknown email"));
        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw failed("bad credentials");
        }
        if (user.getStatus() == UserStatus.SUSPENDED) {
            log.info("Login rejected: account {} suspended", user.getId());
            throw new AccountSuspendedException();
        }
        log.info("Login succeeded for account {}", user.getId());
        return toResponse(user);
    }

    private AuthenticationFailedException failed(String category) {
        log.info("Login failed: {}", category);
        return new AuthenticationFailedException();
    }

    private UserResponse toResponse(User user) {
        return new UserResponse(
                user.getId(), user.getCognitoSub(), user.getEmail(), user.getPhone(),
                user.getFullName(), user.getAvatarUrl(), user.getStatus(),
                user.getAccountType(), user.getCreatedAt(), user.getUpdatedAt());
    }
}
