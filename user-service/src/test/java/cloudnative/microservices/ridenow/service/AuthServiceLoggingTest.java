package cloudnative.microservices.ridenow.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import cloudnative.microservices.ridenow.dto.request.LoginRequest;
import cloudnative.microservices.ridenow.dto.request.RegisterRequest;
import cloudnative.microservices.ridenow.entity.AccountType;
import cloudnative.microservices.ridenow.entity.User;
import cloudnative.microservices.ridenow.exception.AuthenticationFailedException;
import cloudnative.microservices.ridenow.exception.DuplicateResourceException;
import cloudnative.microservices.ridenow.repository.UserRepository;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * Verifies that no password or hash reaches the logs during register and login.
 *
 * <p><b>Validates: Requirements 12.3</b>
 */
class AuthServiceLoggingTest {

    private static final String PASSWORD = "Sup3r-Secret-Pw";
    private static final String WRONG = "Wr0ng-Secret-Pw";

    private final List<User> store = new ArrayList<>();
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private final Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    private AuthService service;

    @BeforeEach
    void setUp() {
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
        service = new AuthService(repo);
        root.setLevel(Level.TRACE);
        appender.start();
        root.addAppender(appender);
    }

    @AfterEach
    void tearDown() {
        root.detachAppender(appender);
        appender.stop();
    }

    @Test
    void passwordAndHashNeverAppearInLogs() {
        service.register(new RegisterRequest("ann@ridenow.test", PASSWORD, "Ann", AccountType.RIDER));
        service.login(new LoginRequest("ann@ridenow.test", PASSWORD));
        assertThatThrownBy(() -> service.login(new LoginRequest("ann@ridenow.test", WRONG)))
                .isInstanceOf(AuthenticationFailedException.class);
        assertThatThrownBy(() -> service.login(new LoginRequest("nobody@ridenow.test", WRONG)))
                .isInstanceOf(AuthenticationFailedException.class);
        assertThatThrownBy(() -> service.register(
                new RegisterRequest("ann@ridenow.test", PASSWORD, "Ann", AccountType.RIDER)))
                .isInstanceOf(DuplicateResourceException.class);

        String hash = store.get(0).getPasswordHash();
        assertThat(appender.list).isNotEmpty();
        for (ILoggingEvent event : appender.list) {
            String text = event.getFormattedMessage();
            assertThat(text).doesNotContain(PASSWORD).doesNotContain(WRONG).doesNotContain(hash);
            assertThat(event.getThrowableProxy()).isNull();
        }
    }
}
