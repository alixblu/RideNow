package cloudnative.microservices.driver.dto.response;

import java.util.List;

public record PageResponse<T>(List<T> items, long total, int limit, int offset) {
}
