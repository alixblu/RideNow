package cloudnative.microservices.ridenow.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cloudnative.microservices.ridenow.dto.request.CreateUserRequest;
import cloudnative.microservices.ridenow.dto.response.PageResponse;
import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.DuplicateResourceException;
import cloudnative.microservices.ridenow.repository.UserRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
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

    // --- listUsers paging rules ---------------------------------------------

    /** Builds n users with distinct ids/emails in the order the repository returns them. */
    private List<User> users(int n) {
        Instant now = Instant.now();
        return IntStream.range(0, n)
                .mapToObj(i -> new User(UUID.randomUUID(), "sub-" + i, "u" + i + "@ridenow.test",
                        null, "User " + i, null, now))
                .toList();
    }

    @Test
    void listUsersAppliesDefaultLimitWhenLimitNotPositive() {
        when(userRepository.findAllByOrderByCreatedAtDesc()).thenReturn(users(5));
        when(userRepository.count()).thenReturn(5L);

        PageResponse<UserResponse> page = userService.listUsers(0, 0);

        assertThat(page.limit()).isEqualTo(20);
        assertThat(page.items()).hasSize(5);
        assertThat(page.total()).isEqualTo(5L);
    }

    @Test
    void listUsersClampsLimitToHundred() {
        when(userRepository.findAllByOrderByCreatedAtDesc()).thenReturn(users(150));
        when(userRepository.count()).thenReturn(150L);

        PageResponse<UserResponse> page = userService.listUsers(500, 0);

        assertThat(page.limit()).isEqualTo(100);
        assertThat(page.items()).hasSize(100);
        assertThat(page.total()).isEqualTo(150L);
    }

    @Test
    void listUsersReturnsCorrectWindowInRepositoryOrder() {
        List<User> all = users(10);
        when(userRepository.findAllByOrderByCreatedAtDesc()).thenReturn(all);
        when(userRepository.count()).thenReturn(10L);

        PageResponse<UserResponse> page = userService.listUsers(3, 4);

        assertThat(page.offset()).isEqualTo(4);
        assertThat(page.limit()).isEqualTo(3);
        // Window [4, 7) in the repository's returned order (newest-first).
        assertThat(page.items()).extracting(UserResponse::id)
                .containsExactly(all.get(4).getId(), all.get(5).getId(), all.get(6).getId());
    }

    @Test
    void listUsersReturnsEmptyWhenOffsetBeyondSize() {
        when(userRepository.findAllByOrderByCreatedAtDesc()).thenReturn(users(3));
        when(userRepository.count()).thenReturn(3L);

        PageResponse<UserResponse> page = userService.listUsers(20, 50);

        assertThat(page.items()).isEmpty();
        assertThat(page.total()).isEqualTo(3L);
    }
}
