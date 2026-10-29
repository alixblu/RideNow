package cloudnative.microservices.driver.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cloudnative.microservices.driver.dto.response.DriverLiveStateResponse;
import cloudnative.microservices.driver.exception.GlobalExceptionHandler;
import cloudnative.microservices.driver.exception.ResourceNotFoundException;
import cloudnative.microservices.driver.live.Availability;
import cloudnative.microservices.driver.service.DriverLiveService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Web-slice tests for the live-state endpoints: online returns the state JSON,
 * a valid location report is accepted, an out-of-range coordinate is rejected
 * 400, and a missing live state surfaces as 404.
 */
@WebMvcTest(DriverLiveController.class)
@Import(GlobalExceptionHandler.class)
class DriverLiveControllerTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private DriverLiveService driverLiveService;

    private DriverLiveStateResponse online(UUID id) {
        return new DriverLiveStateResponse(id, Availability.ONLINE,
                new BigDecimal("10.5"), new BigDecimal("106.5"), Instant.now());
    }

    @Test
    void goOnlineReturnsState() throws Exception {
        UUID id = UUID.randomUUID();
        when(driverLiveService.goOnline(eq(id))).thenReturn(online(id));

        mockMvc.perform(post("/api/drivers/{id}/online", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availability").value("ONLINE"));
    }

    @Test
    void updateLocationAcceptsValidCoordinates() throws Exception {
        UUID id = UUID.randomUUID();
        when(driverLiveService.updateLocation(eq(id), any(), any())).thenReturn(online(id));

        mockMvc.perform(post("/api/drivers/{id}/location", id)
                        .contentType("application/json")
                        .content("{\"lat\":10.5,\"lng\":106.5}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lat").value(10.5));
    }

    @Test
    void updateLocationRejectsOutOfRangeLat() throws Exception {
        UUID id = UUID.randomUUID();

        mockMvc.perform(post("/api/drivers/{id}/location", id)
                        .contentType("application/json")
                        .content("{\"lat\":999,\"lng\":106.5}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void getLiveStateSurfacesNotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(driverLiveService.getLiveState(eq(id)))
                .thenThrow(new ResourceNotFoundException("Live state for driver", id));

        mockMvc.perform(get("/api/drivers/{id}/live", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404));
    }
}
