package cloudnative.microservices.driver.dto.request;

import cloudnative.microservices.driver.entity.VehicleType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public record CreateVehicleRequest(
        @NotBlank(message = "plateNumber is required") String plateNumber,
        @NotNull(message = "vehicleType is required (MOTORBIKE or CAR)") VehicleType vehicleType,
        String brand,
        String model,
        String color
) {
}