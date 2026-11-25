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
import java.util.Optional;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Feature: frontend-booking-and-password-login, Property 2:
 * Duplicate email is always rejected regardless of other fields.
 *
 * <p>Runs the real {@link AuthController}, {@link AuthService} and
 * {@link GlobalExceptionHandler} over an in-memory repository, so the 409 comes
 * from the production code path.
 *
 * <p><b>Validates: Requirements 1.3</b>
 */
class DuplicateEmailPropertyTest {

    record Payload(String email, String password, String fullName, AccountType accountType) {}

    @Provide
    Arbitrary<String> emails() {
        return Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20)
                .map(local -> local + "@ridenow.test");
    }

    @Provide
    Arbitrary<Payload> payloads() {
        Arbitrary<String> passwords = Arbitraries.strings().alpha().numeric().ofMinLength(8).ofMaxLength(72);
        Arbitrary<String> names = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(30);
        Arbitrary<AccountType> types = Arbitraries.of(AccountType.class);
        return Combinators.combine(emails(), passwords, names, types).as(Payload::new);
    }

    private static String json(Payload p) {
        return "{\"email\":\"" + p.email() + "\",\"password\":\"" + p.password()
                + "\",\"fullName\":\"" + p.fullName() + "\",\"accountType\":\"" + p.accountType() + "\"}";
    }

    @Property(tries = 100)
    void reusedEmailIsAlwaysRejectedWith409(
            @ForAll("payloads") Payload first, @ForAll("payloads") Payload second) throws Exception {
        List<User> store = new ArrayList<>();
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

        MockMvc mvc = standaloneSetup(new AuthController(new AuthService(repo)))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        int firstStatus = mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON).content(json(first)))
                .andReturn().getResponse().getStatus();
        assertThat(firstStatus).isEqualTo(201);

        // Same email, everything else independently generated.
        Payload duplicate = new Payload(first.email(), second.password(), second.fullName(), second.accountType());
        int duplicateStatus = mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON).content(json(duplicate)))
                .andReturn().getResponse().getStatus();

        assertThat(duplicateStatus).isEqualTo(409);
        assertThat(store).hasSize(1);
    }
}
