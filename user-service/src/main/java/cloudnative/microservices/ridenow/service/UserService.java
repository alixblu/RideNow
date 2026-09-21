package cloudnative.microservices.ridenow.service;

import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.ResourceNotFoundException;
import cloudnative.microservices.ridenow.repository.UserRepository;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;

    public UserResponse getUser(UUID id) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));

        return new UserResponse(
                user.getId(),
                user.getCognitoSub(),
                user.getEmail(),
                user.getPhone(),
                user.getFullName(),
                user.getAvatarUrl(),
                user.getStatus(),
                user.getCreatedAt(),
                user.getUpdatedAt()
        );
    }
}
