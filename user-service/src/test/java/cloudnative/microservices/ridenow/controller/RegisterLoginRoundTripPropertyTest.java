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
 * Feature: frontend-booking-and-password-login, Property 6:
 * Registration and login round-trip to the same account id.
 *
 * <p>Runs the real {@link AuthController}, {@link AuthService} and
 * {@link GlobalExceptionHandler} over an in-memory repository.
 *
 * <p><b>Validates: Requirements 2.6, 2.1, 2.4</b>
 */
class RegisterLoginRoundTripPropertyTest {

    private static final Pattern ID = Pattern.compile("\"id\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern ACCOUNT_TYPE = Pattern.compile("\"accountType\"\\s*:\\s*\"([^\"]+)\"");
    private static final Pattern EMAIL = Pattern.compile("\"email\"\\s*:\\s*\"([^\"]+)\"");

    record Account(String email, String password, String fullName, AccountType type) {}

    @Provide
    Arbitrary<Account> accounts() {
        Arbitrary<String> emails = Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20)
                .map(l -> l + "@ridenow.test");
        // JSON-safe: letters, digits and a few symbols, no quotes or backslashes.
        Arbitrary<String> passwords = Arbitraries.strings().alpha().numeric().withChars('!', '#', '-', '_', '.')
                .ofMinLength(8).ofMaxLength(72);
        Arbitrary<String> names = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(30);
        Arbitrary<AccountType> types = Arbitraries.of(AccountType.class);
        return Combinators.combine(emails, passwords, names, types).as(Account::new);
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

    private static String find(Pattern p, String json) {
        Matcher m = p.matcher(json);
        assertThat(m.find()).as("%s in %s", p, json).isTrue();
        return m.group(1);
    }

    @Property(tries = 100)
    void loginAfterRegisterReturnsSameAccount(@ForAll("accounts") Account a) throws Exception {
        MockMvc mvc = newMvc(new ArrayList<>());

        String regBody = "{\"email\":\"" + a.email() + "\",\"password\":\"" + a.password()
                + "\",\"fullName\":\"" + a.fullName() + "\",\"accountType\":\"" + a.type() + "\"}";
        MockHttpServletResponse created = mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON).content(regBody))
                .andReturn().getResponse();
        assertThat(created.getStatus()).isEqualTo(201);
        String registeredJson = created.getContentAsString();

        String loginBody = "{\"email\":\"" + a.email() + "\",\"password\":\"" + a.password() + "\"}";
        MockHttpServletResponse login = mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(loginBody))
                .andReturn().getResponse();
        assertThat(login.getStatus()).isEqualTo(200);
        String loginJson = login.getContentAsString();

        assertThat(find(ID, loginJson)).isEqualTo(find(ID, registeredJson));
        assertThat(find(EMAIL, loginJson)).isEqualTo(a.email());
        assertThat(find(ACCOUNT_TYPE, loginJson)).isEqualTo(a.type().name());
    }
}
