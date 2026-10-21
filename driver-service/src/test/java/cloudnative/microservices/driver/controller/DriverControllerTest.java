package cloudnative.microservices.driver.controller;

import static org.hamcrest.Matchers.hasSize;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.PageResponse;
import cloudnative.microservices.driver.entity.DriverStatus;
import cloudnative.microservices.driver.service.DriverService;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Web-slice tests for the drivers list endpoint: happy-path page JSON, status
 * filtering reaching the service, and the two 400 paths (bad limit, bad enum).
 */
@WebMvcTest(DriverController.class)
class DriverControllerTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private DriverService driverService;

    private DriverResponse driverResponse() {
        return new DriverResponse(UUID.randomUUID(), UUID.randomUUID(), "LIC-1",
                DriverStatus.ACTIVE, BigDecimal.ZERO, 0L, Instant.now(), Instant.now());
    }

    @Test
    void listReturnsPageJson() throws Exception {
        PageResponse<DriverResponse> page = new PageResponse<>(List.of(driverResponse()), 1L, 20, 0);
        when(driverService.listDrivers(20, 0, null)).thenReturn(page);

        mockMvc.perform(get("/api/drivers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void statusParamIsPassedToService() throws Exception {
        when(driverService.listDrivers(eq(20), eq(0), any()))
                .thenReturn(new PageResponse<>(List.of(), 0L, 20, 0));

        mockMvc.perform(get("/api/drivers").param("status", "ACTIVE"))
                .andExpect(status().isOk());

        verify(driverService).listDrivers(20, 0, DriverStatus.ACTIVE);
    }

    @Test
    void negativeLimitIsBadRequest() throws Exception {
        mockMvc.perform(get("/api/drivers").param("limit", "-5"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void bogusStatusIsBadRequest() throws Exception {
        mockMvc.perform(get("/api/drivers").param("status", "BOGUS"))
                .andExpect(status().isBadRequest());
    }
}
