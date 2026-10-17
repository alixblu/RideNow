package cloudnative.microservices.ridenow.service;

import cloudnative.microservices.ridenow.dto.request.CreateUserRequest;
import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.DuplicateResourceException;
import cloudnative.microservices.ridenow.exception.ResourceNotFoundException;
import cloudnative.microservices.ridenow.repository.UserRepository;
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

    private UserResponse toResponse(User user) {
        return new UserResponse(
                user.getId(), user.getCognitoSub(), user.getEmail(), user.getPhone(),
                user.getFullName(), user.getAvatarUrl(), user.getStatus(),
                user.getCreatedAt(), user.getUpdatedAt());
    }
}