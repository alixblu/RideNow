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
import java.util.ArrayList;
import java.util.List;
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
 * Feature: frontend-booking-and-password-login, Property 4:
 * Email comparison is case-insensitive for duplicates and login.
 *
 * <p>Runs the real {@link AuthController}, {@link AuthService} and
 * {@link GlobalExceptionHandler} over an in-memory repository whose
 * {@code findByEmailIgnoreCase} mirrors the derived query's semantics.
 *
 * <p><b>Validates: Requirements 1.5, 2.1</b>
 */
class CaseInsensitiveEmailPropertyTest {

    private static final Pattern ID = Pattern.compile("\"id\"\\s*:\\s*\"([^\"]+)\"");

    record Case(String email, String variant, String password) {}

    @Provide
    Arbitrary<Case> cases() {
        Arbitrary<String> locals = Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20);
        Arbitrary<String> passwords = Arbitraries.strings().alpha().numeric().ofMinLength(8).ofMaxLength(72);
        return Combinators.combine(locals, passwords).as((l, p) -> new Object[] {l, p})
                .flatMap(a -> {
                    String email = a[0] + "@ridenow.test";
                    return Arbitraries.of(true, false).list().ofSize(email.length())
                            .map(flips -> new Case(email, flipCase(email, flips), (String) a[1]));
                });
    }

    private static String flipCase(String s, List<Boolean> upper) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            sb.append(upper.get(i) ? Character.toUpperCase(c) : Character.toLowerCase(c));
        }
        return sb.toString();
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

    private static MockHttpServletResponse register(MockMvc mvc, String email, String password) throws Exception {
        String body = "{\"email\":\"" + email + "\",\"password\":\"" + password
                + "\",\"fullName\":\"Test User\",\"accountType\":\"" + AccountType.RIDER + "\"}";
        return mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn().getResponse();
    }

    private static String idOf(String json) {
        Matcher m = ID.matcher(json);
        assertThat(m.find()).isTrue();
        return m.group(1);
    }

    @Property(tries = 100)
    void caseVariantsAreDuplicatesAndLogInToSameAccount(@ForAll("cases") Case c) throws Exception {
        List<User> store = new ArrayList<>();
        MockMvc mvc = newMvc(store);

        MockHttpServletResponse created = register(mvc, c.email(), c.password());
        assertThat(created.getStatus()).isEqualTo(201);
        String id = idOf(created.getContentAsString());

        assertThat(register(mvc, c.variant(), c.password()).getStatus()).isEqualTo(409);
        assertThat(store).hasSize(1);

        String loginBody = "{\"email\":\"" + c.variant() + "\",\"password\":\"" + c.password() + "\"}";
        MockHttpServletResponse login = mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(loginBody))
                .andReturn().getResponse();
        assertThat(login.getStatus()).isEqualTo(200);
        assertThat(idOf(login.getContentAsString())).isEqualTo(id);
    }
}
