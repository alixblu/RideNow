package cloudnative.microservices.ridenow.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor
public class User {

    @Id
    private UUID id;

    @Column(name = "cognito_sub", unique = true)
    private String cognitoSub;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(unique = true)
    private String phone;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Column(name = "avatar_url")
    private String avatarUrl;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserStatus status;

    /** BCrypt hash; null for accounts created without a password. Never exposed in responses. */
    @Column(name = "password_hash")
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false)
    private AccountType accountType;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Creates a new active user; server owns id, status, and timestamps. */
    public User(UUID id, String cognitoSub, String email, String phone,
                String fullName, String avatarUrl, Instant now) {
        this.id = id;
        this.cognitoSub = cognitoSub;
        this.email = email;
        this.phone = phone;
        this.fullName = fullName;
        this.avatarUrl = avatarUrl;
        this.status = UserStatus.ACTIVE;
        this.accountType = AccountType.RIDER;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** Creates a new active password account; it has no Cognito identity. */
    public User(UUID id, String email, String fullName, String passwordHash,
                AccountType accountType, Instant now) {
        this.id = id;
        this.email = email;
        this.fullName = fullName;
        this.passwordHash = passwordHash;
        this.accountType = accountType;
        this.status = UserStatus.ACTIVE;
        this.createdAt = now;
        this.updatedAt = now;
    }
}