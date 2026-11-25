package cloudnative.microservices.ridenow.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.ArgumentMatchers.any;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.GlobalExceptionHandler;
import cloudnative.microservices.ridenow.repository.UserRepository;
import cloudnative.microservices.ridenow.service.AuthService;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Feature: frontend-booking-and-password-login, Property 3:
 * An invalid field always yields a 400 naming that field.
 *
 * <p>Starts from a valid payload, breaks exactly one field, and checks that
 * {@code POST /api/auth/register} answers 400 with a message naming that field.
 *
 * <p><b>Validates: Requirements 1.4</b>
 */
class InvalidFieldPropertyTest {

    private static final String VALID_EMAIL = "valid@ridenow.test";
    private static final String VALID_PASSWORD = "password123";
    private static final String VALID_NAME = "Valid Name";
    private static final String VALID_TYPE = "RIDER";

    /** One invalid value for one named field; the other fields stay valid. */
    record Invalid(String field, String email, String password, String fullName, String accountType) {}

    @Provide
    Arbitrary<Invalid> invalidPayloads() {
        Arbitrary<Invalid> shortPassword = Arbitraries.strings().alpha().numeric().ofMaxLength(7)
                .map(p -> new Invalid("password", VALID_EMAIL, p, VALID_NAME, VALID_TYPE));
        Arbitrary<Invalid> longPassword = Arbitraries.strings().alpha().numeric().ofMinLength(73).ofMaxLength(120)
                .map(p -> new Invalid("password", VALID_EMAIL, p, VALID_NAME, VALID_TYPE));
        Arbitrary<Invalid> badEmail = Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20)
                .map(e -> new Invalid("email", e, VALID_PASSWORD, VALID_NAME, VALID_TYPE));
        Arbitrary<Invalid> blankName = Arbitraries.strings().withChars(' ').ofMaxLength(10)
                .map(n -> new Invalid("fullName", VALID_EMAIL, VALID_PASSWORD, n, VALID_TYPE));
        Arbitrary<Invalid> badType = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(15)
                .filter(t -> !t.equals("RIDER") && !t.equals("DRIVER"))
                .map(t -> new Invalid("accountType", VALID_EMAIL, VALID_PASSWORD, VALID_NAME, t));
        return Arbitraries.oneOf(shortPassword, longPassword, badEmail, blankName, badType);
    }

    private static String json(Invalid p) {
        return "{\"email\":\"" + p.email() + "\",\"password\":\"" + p.password()
                + "\",\"fullName\":\"" + p.fullName() + "\",\"accountType\":\"" + p.accountType() + "\"}";
    }

    @Property(tries = 100)
    void invalidFieldYields400NamingThatField(@ForAll("invalidPayloads") Invalid payload) throws Exception {
        UserRepository repo = mock(UserRepository.class);
        MockMvc mvc = standaloneSetup(new AuthController(new AuthService(repo)))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        MockHttpServletResponse response = mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON).content(json(payload)))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(400);
        assertThat(response.getContentAsString()).contains(payload.field());
        verify(repo, never()).save(any(User.class));
    }
}
