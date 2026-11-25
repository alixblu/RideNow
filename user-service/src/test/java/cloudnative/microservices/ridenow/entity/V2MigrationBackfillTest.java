package cloudnative.microservices.ridenow.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * No database is available to unit tests, so the V2 migration is checked as text and the
 * entity is checked for the same backfill value an existing row receives.
 *
 * <p><b>Validates: Requirements 1.7</b>
 */
class V2MigrationBackfillTest {

    private static String sql(String name) throws IOException {
        try (InputStream in = V2MigrationBackfillTest.class.getResourceAsStream("/db/migration/" + name)) {
            assertThat(in).as(name + " on classpath").isNotNull();
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String statements(String sql) {
        StringBuilder sb = new StringBuilder();
        for (String line : sql.split("\\R")) {
            if (!line.trim().startsWith("--")) {
                sb.append(line).append(' ');
            }
        }
        return sb.toString().replaceAll("\\s+", " ").toLowerCase();
    }

    @Test
    void existingRowsAreBackfilledToRiderByColumnDefault() throws IOException {
        String s = statements(sql("V2__add_password_auth.sql"));

        assertThat(s).contains("add column account_type varchar(255) not null default 'rider'");
    }

    @Test
    void passwordHashIsNullableAndCognitoSubBecomesOptional() throws IOException {
        String s = statements(sql("V2__add_password_auth.sql"));

        assertThat(s).contains("alter column cognito_sub drop not null");
        assertThat(s).contains("add column password_hash varchar(255);");
    }

    @Test
    void v1SchemaIsUntouchedByV2() throws IOException {
        assertThat(statements(sql("V1__init_schema.sql"))).doesNotContain("account_type");
    }

    @Test
    void legacyEntityConstructionYieldsRiderWithNoPasswordHash() {
        User legacy = new User(UUID.randomUUID(), "sub-1", "old@ridenow.test", null, "Old", null, Instant.now());

        assertThat(legacy.getAccountType()).isEqualTo(AccountType.RIDER);
        assertThat(legacy.getPasswordHash()).isNull();
        assertThat(legacy.getStatus()).isEqualTo(UserStatus.ACTIVE);
    }
}
