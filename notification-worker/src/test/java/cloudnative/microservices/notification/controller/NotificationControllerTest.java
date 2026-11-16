package cloudnative.microservices.notification.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cloudnative.microservices.notification.dto.NotificationResponse;
import cloudnative.microservices.notification.exception.InvalidCursorException;
import cloudnative.microservices.notification.exception.ResourceNotFoundException;
import cloudnative.microservices.notification.service.NotificationInboxService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(NotificationController.class)
class NotificationControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockitoBean private NotificationInboxService inboxService;

    private final UUID userId = UUID.randomUUID();

    private NotificationResponse item() {
        return new NotificationResponse(UUID.randomUUID(), userId, "driver.accepted",
                "A driver has accepted your trip.", UUID.randomUUID(), Instant.now(), Instant.now(), null);
    }

    @Test
    void listReturnsItemsWithTheContractFields() throws Exception {
        when(inboxService.list(eq(userId), eq(null), eq(50))).thenReturn(List.of(item()));

        mockMvc.perform(get("/api/notifications").param("userId", userId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].userId").value(userId.toString()))
                .andExpect(jsonPath("$[0].type").value("driver.accepted"))
                .andExpect(jsonPath("$[0].message").value("A driver has accepted your trip."))
                .andExpect(jsonPath("$[0].readAt").doesNotExist());
    }

    @Test
    void sinceAndLimitArePassedThrough() throws Exception {
        UUID since = UUID.randomUUID();
        when(inboxService.list(any(), any(), eq(5))).thenReturn(List.of());

        mockMvc.perform(get("/api/notifications")
                        .param("userId", userId.toString())
                        .param("since", since.toString())
                        .param("limit", "5"))
                .andExpect(status().isOk());

        verify(inboxService).list(userId, since, 5);
    }

    @Test
    void aBadUuidIs400() throws Exception {
        mockMvc.perform(get("/api/notifications").param("userId", "nope"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
        mockMvc.perform(get("/api/notifications")
                        .param("userId", userId.toString()).param("since", "nope"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void aMissingUserIdIs400() throws Exception {
        mockMvc.perform(get("/api/notifications")).andExpect(status().isBadRequest());
    }

    @Test
    void aNonPositiveLimitIs400() throws Exception {
        mockMvc.perform(get("/api/notifications")
                        .param("userId", userId.toString()).param("limit", "0"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void anUnknownCursorIs400() throws Exception {
        when(inboxService.list(any(), any(), eq(50))).thenThrow(new InvalidCursorException("Unknown 'since' cursor"));

        mockMvc.perform(get("/api/notifications")
                        .param("userId", userId.toString()).param("since", UUID.randomUUID().toString()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void markReadReturnsTheItem() throws Exception {
        NotificationResponse read = item();
        when(inboxService.markRead(read.id())).thenReturn(read);

        mockMvc.perform(post("/api/notifications/{id}/read", read.id()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(read.id().toString()));
    }

    @Test
    void markReadOnAnUnknownIdIs404() throws Exception {
        UUID id = UUID.randomUUID();
        when(inboxService.markRead(id)).thenThrow(new ResourceNotFoundException("Notification not found"));

        mockMvc.perform(post("/api/notifications/{id}/read", id)).andExpect(status().isNotFound());
    }
}
