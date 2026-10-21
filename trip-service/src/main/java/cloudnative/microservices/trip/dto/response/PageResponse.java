package cloudnative.microservices.trip.dto.response;

import java.util.List;

public record PageResponse<T>(List<T> items, long total, int limit, int offset) {
}
