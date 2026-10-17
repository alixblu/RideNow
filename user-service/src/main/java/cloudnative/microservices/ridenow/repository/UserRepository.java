package cloudnative.microservices.ridenow.repository;

import cloudnative.microservices.ridenow.entity.User;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {
    boolean existsByEmail(String email);
    boolean existsByCognitoSub(String cognitoSub);
}