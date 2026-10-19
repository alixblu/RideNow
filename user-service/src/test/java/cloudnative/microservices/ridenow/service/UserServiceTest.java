package cloudnative.microservices.ridenow.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.ridenow.dto.request.CreateUserRequest;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.DuplicateResourceException;
import cloudnative.microservices.ridenow.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * User creation rules, verified with mocks (no running DB).
 * Each uniqueness rule must be rejected as a DuplicateResourceException (-> 409)
 * BEFORE the insert, so the client never sees a raw 500 from a DB constraint.
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock private UserRepository userRepository;

    @InjectMocks private UserService userService;

    private CreateUserRequest request(String phone) {
        return new CreateUserRequest("sub-1", "a@ridenow.test", phone, "Full Name", null);
    }

    @Test
    void createsUserWhenAllFieldsAreUnique() {
        CreateUserRequest req = request("+849000001");
        when(userRepository.existsByEmail("a@ridenow.test")).thenReturn(false);
        when(userRepository.existsByCognitoSub("sub-1")).thenReturn(false);
        when(userRepository.existsByPhone("+849000001")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        var result = userService.createUser(req);

        assertThat(result.email()).isEqualTo("a@ridenow.test");
        verify(userRepository).save(any(User.class));
    }

    @Test
    void rejectsDuplicateEmail() {
        when(userRepository.existsByEmail("a@ridenow.test")).thenReturn(true);

        assertThatThrownBy(() -> userService.createUser(request("+849000001")))
                .isInstanceOf(DuplicateResourceException.class);
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void rejectsDuplicatePhone() {
        when(userRepository.existsByEmail("a@ridenow.test")).thenReturn(false);
        when(userRepository.existsByCognitoSub("sub-1")).thenReturn(false);
        when(userRepository.existsByPhone("+849000001")).thenReturn(true);

        assertThatThrownBy(() -> userService.createUser(request("+849000001")))
                .isInstanceOf(DuplicateResourceException.class);
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void nullPhoneSkipsPhoneCheckAndCreates() {
        CreateUserRequest req = request(null);
        when(userRepository.existsByEmail("a@ridenow.test")).thenReturn(false);
        when(userRepository.existsByCognitoSub("sub-1")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        var result = userService.createUser(req);

        assertThat(result.phone()).isNull();
        // Phone existence must NOT be queried when no phone was supplied.
        verify(userRepository, never()).existsByPhone(any());
        verify(userRepository).save(any(User.class));
    }
}
