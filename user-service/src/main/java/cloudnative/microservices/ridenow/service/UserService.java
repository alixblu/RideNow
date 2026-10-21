package cloudnative.microservices.ridenow.service;

import cloudnative.microservices.ridenow.dto.request.CreateUserRequest;
import cloudnative.microservices.ridenow.dto.response.PageResponse;
import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.DuplicateResourceException;
import cloudnative.microservices.ridenow.exception.ResourceNotFoundException;
import cloudnative.microservices.ridenow.repository.UserRepository;
import java.time.Instant;
import java.util.List;
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
        // Phone is optional (nullable, unique). Only check it when one was given,
        // so a null phone never triggers a false duplicate.
        if (request.phone() != null && !request.phone().isBlank()
                && userRepository.existsByPhone(request.phone())) {
            throw new DuplicateResourceException("Phone already registered: " + request.phone());
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

    @Transactional(readOnly = true)
    public PageResponse<UserResponse> listUsers(int limit, int offset) {
        int effectiveLimit = limit <= 0 ? 20 : Math.min(limit, 100);
        int effectiveOffset = Math.max(offset, 0);

        List<User> all = userRepository.findAllByOrderByCreatedAtDesc();
        List<UserResponse> items;
        if (effectiveOffset >= all.size()) {
            items = List.of();
        } else {
            int end = Math.min(effectiveOffset + effectiveLimit, all.size());
            items = all.subList(effectiveOffset, end).stream()
                    .map(this::toResponse)
                    .toList();
        }
        long total = userRepository.count();
        return new PageResponse<>(items, total, effectiveLimit, effectiveOffset);
    }

    private UserResponse toResponse(User user) {
        return new UserResponse(
                user.getId(), user.getCognitoSub(), user.getEmail(), user.getPhone(),
                user.getFullName(), user.getAvatarUrl(), user.getStatus(),
                user.getCreatedAt(), user.getUpdatedAt());
    }
}