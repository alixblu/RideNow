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
import cloudnative.microservices.ridenow.exception.GlobalExceptionHandler;
import cloudnative.microservices.ridenow.repository.UserRepository;
import cloudnative.microservices.ridenow.service.AuthService;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Feature: frontend-booking-and-password-login, Property 5:
 * Login failure is indistinguishable across its three causes.
 *
 * <p>Runs the real {@link AuthController}, {@link AuthService} and
 * {@link GlobalExceptionHandler} over an in-memory repository.
 *
 * <p><b>Validates: Requirements 2.2</b>
 */
class IndistinguishableLoginFailurePropertyTest {

    private static final Pattern MESSAGE = Pattern.compile("\"message\"\\s*:\\s*\"([^\"]*)\"");

    record Case(String local, String password, String wrongPassword, String anyPassword) {}

    @Provide
    Arbitrary<Case> cases() {
        Arbitrary<String> locals = Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20);
        Arbitrary<String> passwords = Arbitraries.strings().alpha().numeric().ofMinLength(8).ofMaxLength(72);
        return Combinators.combine(locals, passwords, passwords, passwords)
                .as(Case::new)
                .filter(c -> !c.password().equals(c.wrongPassword()));
    }

    private static MockMvc newMvc(List<User> store) {
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
        return standaloneSetup(new AuthController(new AuthService(repo)))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private static MockHttpServletResponse login(MockMvc mvc, String email, String password) throws Exception {
        String body = "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
        return mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn().getResponse();
    }

    private static String messageOf(MockHttpServletResponse response) throws Exception {
        Matcher m = MESSAGE.matcher(response.getContentAsString());
        assertThat(m.find()).as("response has a message").isTrue();
        return m.group(1);
    }

    @Property(tries = 100)
    void allThreeFailureCausesLookIdentical(@ForAll("cases") Case c) throws Exception {
        List<User> store = new ArrayList<>();
        MockMvc mvc = newMvc(store);

        String registered = c.local() + "@ridenow.test";
        String unknown = c.local() + "@unknown.test";
        String noHash = c.local() + "@nohash.test";

        String registerBody = "{\"email\":\"" + registered + "\",\"password\":\"" + c.password()
                + "\",\"fullName\":\"Test User\",\"accountType\":\"" + AccountType.RIDER + "\"}";
        assertThat(mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content(registerBody)).andReturn().getResponse().getStatus()).isEqualTo(201);
        // Legacy-style account: created without a password hash.
        store.add(new User(UUID.randomUUID(), null, noHash, null, "No Hash", null, Instant.now()));

        MockHttpServletResponse unknownEmail = login(mvc, unknown, c.anyPassword());
        MockHttpServletResponse wrongPassword = login(mvc, registered, c.wrongPassword());
        MockHttpServletResponse noPasswordHash = login(mvc, noHash, c.anyPassword());

        assertThat(unknownEmail.getStatus()).isEqualTo(401);
        assertThat(wrongPassword.getStatus()).isEqualTo(401);
        assertThat(noPasswordHash.getStatus()).isEqualTo(401);

        String expected = messageOf(unknownEmail);
        assertThat(messageOf(wrongPassword)).isEqualTo(expected);
        assertThat(messageOf(noPasswordHash)).isEqualTo(expected);
    }
}
