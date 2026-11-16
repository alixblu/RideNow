package cloudnative.microservices.notification.controller;

import cloudnative.microservices.notification.dto.NotificationResponse;
import cloudnative.microservices.notification.service.NotificationInboxService;
import jakarta.validation.constraints.Min;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The inbox API. Clients poll {@code GET /api/notifications?userId=&since=}. */
@RestController
@RequestMapping("/api/notifications")
@Validated
@RequiredArgsConstructor
public class NotificationController {

    private final NotificationInboxService inboxService;

    /**
     * @param since the id of the last item the client has; omit for the newest items
     * @param limit page size; values above 100 are capped to 100
     */
    @GetMapping
    public List<NotificationResponse> list(
            @RequestParam UUID userId,
            @RequestParam(required = false) UUID since,
            @RequestParam(defaultValue = "50") @Min(1) int limit) {
        return inboxService.list(userId, since, limit);
    }

    @PostMapping("/{id}/read")
    public NotificationResponse markRead(@PathVariable UUID id) {
        return inboxService.markRead(id);
    }
}
