package cloudnative.microservices.ridenow.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import cloudnative.microservices.ridenow.entity.AccountType;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.GlobalExceptionHandler;
import cloudnative.microservices.ridenow.repository.UserRepository;
import cloudnative.microservices.ridenow.service.AuthService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Feature: frontend-booking-and-password-login, Property 1: Registration response never
 * carries the password or its hash.
 *
 * <p>Runs the real controller, validation, exception handler and AuthService (with BCrypt)
 * over a repository that stores nothing, so only the HTTP response shape is under test.
 *
 * <p><b>Validates: Requirements 1.1, 1.2</b>
 */
class RegistrationResponseShapePropertyTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private record Registration(String email, String password, String fullName, AccountType accountType) {}

    @Provide
    Arbitrary<Registration> validRegistrations() {
        Arbitrary<String> local = Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20);
        Arbitrary<String> domain = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(12);
        Arbitrary<String> email = Combinators.combine(local, domain).as((l, d) -> l + "@" + d + ".test");
        Arbitrary<String> password = Arbitraries.strings().withCharRange('!', '~')
                .ofMinLength(8).ofMaxLength(72);
        Arbitrary<String> fullName = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(40);
        Arbitrary<AccountType> type = Arbitraries.of(AccountType.class);
        return Combinators.combine(email, password, fullName, type).as(Registration::new);
    }

    @Property(tries = 100)
    void registrationResponseNeverCarriesPasswordOrHash(@ForAll("validRegistrations") Registration reg)
            throws Exception {
        UserRepository repository = mock(UserRepository.class);
        when(repository.findByEmailIgnoreCase(anyString())).thenReturn(Optional.empty());
        List<User> saved = new ArrayList<>();
        when(repository.save(any(User.class))).thenAnswer(inv -> {
            saved.add(inv.getArgument(0));
            return inv.getArgument(0);
        });
        MockMvc mockMvc = MockMvcBuilders
                .standaloneSetup(new AuthController(new AuthService(repository)))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", reg.email());
        body.put("password", reg.password());
        body.put("fullName", reg.fullName());
        body.put("accountType", reg.accountType().name());

        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(JSON.writeValueAsString(body)))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(201);

        String responseText = result.getResponse().getContentAsString();
        JsonNode json = JSON.readTree(responseText);

        for (String field : List.of("id", "email", "fullName", "phone", "status", "accountType")) {
            assertThat(json.has(field)).as("response has key %s", field).isTrue();
        }
        assertThat(json.get("id").asString()).isNotBlank();
        assertThat(json.get("email").asString()).isEqualTo(reg.email());
        assertThat(json.get("fullName").asString()).isEqualTo(reg.fullName());
        assertThat(json.get("status").asString()).isEqualTo("ACTIVE");
        assertThat(json.get("accountType").asString()).isEqualTo(reg.accountType().name());

        for (String key : json.propertyNames()) {
            assertThat(key.toLowerCase()).as("response key %s", key).doesNotContain("password");
        }

        assertThat(saved).hasSize(1);
        String hash = saved.get(0).getPasswordHash();
        assertThat(hash).isNotBlank();
        assertThat(responseText).doesNotContain(hash);
    }
}
