package cloudnative.microservices.ridenow.controller;

import cloudnative.microservices.ridenow.dto.request.CreateUserRequest;
import cloudnative.microservices.ridenow.dto.response.PageResponse;
import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import java.net.URI;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
@RequiredArgsConstructor
@Validated
public class UserController {

    private final UserService userService;

    @PostMapping
    public ResponseEntity<UserResponse> create(@Valid @RequestBody CreateUserRequest request) {
        UserResponse created = userService.createUser(request);
        return ResponseEntity.created(URI.create("/api/users/" + created.id())).body(created);
    }

    @GetMapping
    public PageResponse<UserResponse> listUsers(
            @RequestParam(defaultValue = "20") @Min(0) int limit,
            @RequestParam(defaultValue = "0") @Min(0) int offset) {
        return userService.listUsers(limit, offset);
    }

    @GetMapping("/{id}")
    public UserResponse getUser(@PathVariable UUID id) {
        return userService.getUser(id);
    }
}