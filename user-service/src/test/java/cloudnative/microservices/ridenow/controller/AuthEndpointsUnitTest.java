package cloudnative.microservices.ridenow.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

import cloudnative.microservices.ridenow.entity.AccountType;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.entity.UserStatus;
import cloudnative.microservices.ridenow.exception.GlobalExceptionHandler;
import cloudnative.microservices.ridenow.repository.UserRepository;
import cloudnative.microservices.ridenow.service.AuthService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Unit tests for register and login over the real controller, service and exception
 * handler, with an in-memory repository.
 *
 * <p><b>Validates: Requirements 1.7, 2.3, 2.5</b>
 */
class AuthEndpointsUnitTest {

    private List<User> store;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        store = new ArrayList<>();
        UserRepository repo = mock(UserRepository.class);
        when(repo.findByEmailIgnoreCase(anyString())).thenAnswer(inv -> {
            String email = inv.getArgument(0);
            return store.stream().filter(u -> u.getEmail().equalsIgnoreCase(email)).findFirst();
        });
        when(repo.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            store.add(u);
            return u;
        });
        mvc = standaloneSetup(new AuthController(new AuthService(repo)))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private MockHttpServletResponse send(String path, String body) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn().getResponse();
    }

    private static String registerBody(String email, String password, String fullName) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\",\"fullName\":\""
                + fullName + "\",\"accountType\":\"RIDER\"}";
    }

    private static String loginBody(String email, String password) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
    }

    @Test
    void registrationSucceedsWithoutExposingPasswordOrHash() throws Exception {
        MockHttpServletResponse r = send("/api/auth/register", registerBody("ann@ridenow.test", "secret-pass-1", "Ann"));

        assertThat(r.getStatus()).isEqualTo(201);
        String json = r.getContentAsString();
        assertThat(json).contains("ann@ridenow.test").contains("\"accountType\":\"RIDER\"");
        assertThat(json).doesNotContain("secret-pass-1").doesNotContainIgnoringCase("passwordHash");
        assertThat(store).hasSize(1);
        assertThat(store.get(0).getPasswordHash()).isNotEqualTo("secret-pass-1").startsWith("$2");
        assertThat(store.get(0).getStatus()).isEqualTo(UserStatus.ACTIVE);
    }

    @Test
    void duplicateEmailIsRejectedWith409() throws Exception {
        send("/api/auth/register", registerBody("ann@ridenow.test", "secret-pass-1", "Ann"));

        MockHttpServletResponse r = send("/api/auth/register", registerBody("ANN@ridenow.test", "other-pass-22", "Other"));

        assertThat(r.getStatus()).isEqualTo(409);
        assertThat(store).hasSize(1);
    }

    @Test
    void invalidInputIsRejectedWith400NamingTheField() throws Exception {
        MockHttpServletResponse badEmail = send("/api/auth/register", registerBody("not-an-email", "secret-pass-1", "Ann"));
        MockHttpServletResponse shortPassword = send("/api/auth/register", registerBody("a@ridenow.test", "short", "Ann"));
        MockHttpServletResponse blankName = send("/api/auth/register", registerBody("b@ridenow.test", "secret-pass-1", " "));

        assertThat(badEmail.getStatus()).isEqualTo(400);
        assertThat(badEmail.getContentAsString()).contains("email");
        assertThat(shortPassword.getStatus()).isEqualTo(400);
        assertThat(shortPassword.getContentAsString()).contains("password");
        assertThat(blankName.getStatus()).isEqualTo(400);
        assertThat(blankName.getContentAsString()).contains("fullName");
        assertThat(store).isEmpty();
    }

    @Test
    void loginSucceedsWithCorrectCredentials() throws Exception {
        send("/api/auth/register", registerBody("ann@ridenow.test", "secret-pass-1", "Ann"));

        MockHttpServletResponse r = send("/api/auth/login", loginBody("Ann@Ridenow.test", "secret-pass-1"));

        assertThat(r.getStatus()).isEqualTo(200);
        assertThat(r.getContentAsString()).contains(store.get(0).getId().toString())
                .doesNotContain("secret-pass-1").doesNotContainIgnoringCase("passwordHash");
    }

    @Test
    void wrongPasswordAndUnknownEmailBothYield401WithSameMessage() throws Exception {
        send("/api/auth/register", registerBody("ann@ridenow.test", "secret-pass-1", "Ann"));

        MockHttpServletResponse wrong = send("/api/auth/login", loginBody("ann@ridenow.test", "wrong-pass-99"));
        MockHttpServletResponse unknown = send("/api/auth/login", loginBody("nobody@ridenow.test", "secret-pass-1"));

        assertThat(wrong.getStatus()).isEqualTo(401);
        assertThat(unknown.getStatus()).isEqualTo(401);
        assertThat(messageOf(wrong)).isEqualTo(messageOf(unknown));
    }

    @Test
    void suspendedAccountWithCorrectPasswordYields403() throws Exception {
        send("/api/auth/register", registerBody("ann@ridenow.test", "secret-pass-1", "Ann"));
        ReflectionTestUtils.setField(store.get(0), "status", UserStatus.SUSPENDED);

        MockHttpServletResponse r = send("/api/auth/login", loginBody("ann@ridenow.test", "secret-pass-1"));

        assertThat(r.getStatus()).isEqualTo(403);
    }

    @Test
    void suspendedAccountWithWrongPasswordStillYields401() throws Exception {
        send("/api/auth/register", registerBody("ann@ridenow.test", "secret-pass-1", "Ann"));
        ReflectionTestUtils.setField(store.get(0), "status", UserStatus.SUSPENDED);

        MockHttpServletResponse r = send("/api/auth/login", loginBody("ann@ridenow.test", "wrong-pass-99"));

        assertThat(r.getStatus()).isEqualTo(401);
    }

    @Test
    void legacyAccountWithoutHashCannotLogIn() throws Exception {
        store.add(new User(UUID.randomUUID(), "sub-1", "old@ridenow.test", null, "Old", null, Instant.now()));

        MockHttpServletResponse r = send("/api/auth/login", loginBody("old@ridenow.test", "secret-pass-1"));

        assertThat(r.getStatus()).isEqualTo(401);
    }

    @Test
    void registerAcceptsDriverAccountType() throws Exception {
        String body = "{\"email\":\"d@ridenow.test\",\"password\":\"secret-pass-1\",\"fullName\":\"Dee\",\"accountType\":\""
                + AccountType.DRIVER + "\"}";

        MockHttpServletResponse r = send("/api/auth/register", body);

        assertThat(r.getStatus()).isEqualTo(201);
        assertThat(r.getContentAsString()).contains("\"accountType\":\"DRIVER\"");
    }

    private static String messageOf(MockHttpServletResponse response) throws Exception {
        String json = response.getContentAsString();
        int key = json.indexOf("\"message\"");
        assertThat(key).isGreaterThanOrEqualTo(0);
        int start = json.indexOf('"', json.indexOf(':', key) + 1) + 1;
        return json.substring(start, json.indexOf('"', start));
    }
}
