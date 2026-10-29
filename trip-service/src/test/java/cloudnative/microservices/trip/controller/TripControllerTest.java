package cloudnative.microservices.trip.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cloudnative.microservices.trip.dto.response.PageResponse;
import cloudnative.microservices.trip.dto.response.TripResponse;
import cloudnative.microservices.trip.entity.RideType;
import cloudnative.microservices.trip.entity.TripStatus;
import cloudnative.microservices.trip.exception.GlobalExceptionHandler;
import cloudnative.microservices.trip.exception.ResourceNotFoundException;
import cloudnative.microservices.trip.exception.TripNotCancellableException;
import cloudnative.microservices.trip.exception.TripTransitionException;
import cloudnative.microservices.trip.service.TripService;
import java.math.BigDecimal;
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
 * Web-slice test for the trips list and cancel endpoints: a valid list request
 * returns the page shape, out-of-range/unparseable query params are rejected as
 * 400 ApiErrorResponse, and the cancel endpoint surfaces service exceptions as
 * their mapped HTTP statuses.
 */
@WebMvcTest(TripController.class)
@Import(GlobalExceptionHandler.class)
class TripControllerTest {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private TripService tripService;

    private TripResponse sampleTrip(TripStatus status) {
        Instant now = Instant.now();
        return new TripResponse(UUID.randomUUID(), UUID.randomUUID(), null, null, RideType.CAR,
                new BigDecimal("10.000000"), new BigDecimal("106.000000"), null,
                new BigDecimal("10.100000"), new BigDecimal("106.100000"), null, status,
                null, null, null, 0L,
                now, null, null, null, null, null, now, now);
    }

    @Test
    void listTripsReturnsPageJson() throws Exception {
        PageResponse<TripResponse> page =
                new PageResponse<>(List.of(sampleTrip(TripStatus.SEARCHING)), 1L, 20, 0);
        when(tripService.listTrips(any(), any(), anyInt(), anyInt())).thenReturn(page);

        mockMvc.perform(get("/api/trips"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.limit").value(20))
                .andExpect(jsonPath("$.offset").value(0));
    }

    @Test
    void listTripsWithUnknownStatusIsRejectedWithApiErrorResponse() throws Exception {
        mockMvc.perform(get("/api/trips").param("status", "BOGUS"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.path").value("/api/trips"));
    }

    @Test
    void negativeLimitIsRejectedWithApiErrorResponse() throws Exception {
        mockMvc.perform(get("/api/trips").param("limit", "-1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.message").exists())
                .andExpect(jsonPath("$.path").value("/api/trips"));
    }

    @Test
    void cancelTripReturnsTrip() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.cancelTrip(eq(id), any())).thenReturn(sampleTrip(TripStatus.CANCELLED));

        mockMvc.perform(post("/api/trips/{id}/cancel", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @Test
    void cancelTripSurfacesConflictWhenNotCancellable() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.cancelTrip(eq(id), any()))
                .thenThrow(new TripNotCancellableException(id, TripStatus.COMPLETED));

        mockMvc.perform(post("/api/trips/{id}/cancel", id))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }

    @Test
    void cancelTripSurfacesNotFoundWhenMissing() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.cancelTrip(eq(id), any()))
                .thenThrow(new ResourceNotFoundException("Trip", id));

        mockMvc.perform(post("/api/trips/{id}/cancel", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404));
    }

    @Test
    void arriveTripReturnsTrip() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.arriveTrip(eq(id))).thenReturn(sampleTrip(TripStatus.DRIVER_ARRIVED));

        mockMvc.perform(post("/api/trips/{id}/arrive", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRIVER_ARRIVED"));
    }

    @Test
    void startTripReturnsTrip() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.startTrip(eq(id))).thenReturn(sampleTrip(TripStatus.IN_PROGRESS));

        mockMvc.perform(post("/api/trips/{id}/start", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));
    }

    @Test
    void completeTripReturnsTrip() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.completeTrip(eq(id))).thenReturn(sampleTrip(TripStatus.COMPLETED));

        mockMvc.perform(post("/api/trips/{id}/complete", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    @Test
    void startTripSurfacesConflictOnIllegalTransition() throws Exception {
        UUID id = UUID.randomUUID();
        when(tripService.startTrip(eq(id)))
                .thenThrow(new TripTransitionException(id, TripStatus.DRIVER_ASSIGNED, "started"));

        mockMvc.perform(post("/api/trips/{id}/start", id))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409));
    }
}
