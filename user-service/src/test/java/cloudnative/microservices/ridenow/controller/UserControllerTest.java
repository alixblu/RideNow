package cloudnative.microservices.ridenow.controller;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cloudnative.microservices.ridenow.dto.response.PageResponse;
import cloudnative.microservices.ridenow.dto.response.UserResponse;
import cloudnative.microservices.ridenow.entity.UserStatus;
import cloudnative.microservices.ridenow.exception.GlobalExceptionHandler;
import cloudnative.microservices.ridenow.service.UserService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Web-slice test for the users list endpoint: a valid request returns the page
 * shape, and an out-of-range query param is rejected as a 400 ApiErrorResponse
 * (the @Min on @RequestParam fires via @Validated -> ConstraintViolationException).
 */
@WebMvcTest(UserController.class)
@Import(GlobalExceptionHandler.class)
class UserControllerTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private UserService userService;

    private UserResponse sampleUser() {
        Instant now = Instant.now();
        return new UserResponse(UUID.randomUUID(), "sub-1", "a@ridenow.test", null,
                "Full Name", null, UserStatus.ACTIVE, now, now);
    }

    @Test
    void listUsersReturnsPageJson() throws Exception {
        PageResponse<UserResponse> page =
                new PageResponse<>(List.of(sampleUser()), 1L, 20, 0);
        when(userService.listUsers(anyInt(), anyInt())).thenReturn(page);

        mockMvc.perform(get("/api/users"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void negativeLimitIsRejectedWithApiErrorResponse() throws Exception {
        mockMvc.perform(get("/api/users").param("limit", "-1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.path").value("/api/users"));
    }
}
