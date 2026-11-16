package cloudnative.microservices.matching.event;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import cloudnative.microservices.matching.entity.VehicleType;
import cloudnative.microservices.matching.service.DriverPositionService;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.ObjectMapper;

@ExtendWith(MockitoExtension.class)
class DriverLocationSubscriberTest {

    @Mock private DriverPositionService positionService;

    private final UUID driverId = UUID.randomUUID();

    private DriverLocationSubscriber subscriber() {
        return new DriverLocationSubscriber(positionService, new ObjectMapper());
    }

    @Test
    void aPositionIsUpserted() {
        subscriber().onMessage("{\"driverId\":\"" + driverId + "\",\"lat\":10.7769,\"lng\":106.7009,"
                + "\"recordedAt\":\"2026-11-11T07:00:00Z\",\"vehicleType\":\"MOTORBIKE\",\"online\":true}");

        verify(positionService).reportPosition(eq(driverId), eq(VehicleType.MOTORBIKE),
                argThat(lat -> lat.compareTo(new BigDecimal("10.7769")) == 0),
                argThat(lng -> lng.compareTo(new BigDecimal("106.7009")) == 0));
    }

    @Test
    void anOfflineMarkerRemovesTheDriver() {
        subscriber().onMessage("{\"driverId\":\"" + driverId + "\",\"lat\":null,\"lng\":null,"
                + "\"vehicleType\":null,\"online\":false}");

        verify(positionService).removeDriver(driverId);
        verify(positionService, never()).reportPosition(any(), any(), any(), any());
    }

    @Test
    void malformedMessagesAreDropped() {
        DriverLocationSubscriber subscriber = subscriber();
        subscriber.onMessage("not json");
        subscriber.onMessage("{\"driverId\":\"nope\",\"lat\":1,\"lng\":2,\"vehicleType\":\"CAR\"}");
        subscriber.onMessage("{\"driverId\":\"" + driverId + "\",\"lat\":1,\"lng\":2}");
        subscriber.onMessage("{\"driverId\":\"" + driverId + "\",\"lat\":1,\"lng\":2,\"vehicleType\":\"BUS\"}");
        subscriber.onMessage("{\"driverId\":\"" + driverId + "\",\"lat\":\"x\",\"lng\":2,\"vehicleType\":\"CAR\"}");
        subscriber.onMessage("{\"driverId\":\"" + driverId + "\",\"lat\":91,\"lng\":2,\"vehicleType\":\"CAR\"}");

        verifyNoInteractions(positionService);
    }
}
