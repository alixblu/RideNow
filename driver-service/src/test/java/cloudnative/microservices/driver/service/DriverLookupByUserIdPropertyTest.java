package cloudnative.microservices.driver.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import cloudnative.microservices.driver.cache.DriverProfileCache;
import cloudnative.microservices.driver.client.UserServiceClient;
import cloudnative.microservices.driver.dto.response.DriverResponse;
import cloudnative.microservices.driver.dto.response.PageResponse;
import cloudnative.microservices.driver.entity.Driver;
import cloudnative.microservices.driver.repository.DriverRepository;
import cloudnative.microservices.driver.repository.VehicleRepository;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;

/**
 * Feature: frontend-booking-and-password-login, Property 23:
 * Driver lookup by userId returns exactly the matching driver.
 *
 * <p>The repository is backed by an in-memory map keyed by user id (user_id is
 * unique), so the real {@link DriverService} filtering logic is what is tested.
 *
 * <p><b>Validates: Requirements 9.1</b>
 */
class DriverLookupByUserIdPropertyTest {

    @Provide
    Arbitrary<List<UUID>> distinctUserIds() {
        return Arbitraries.create(UUID::randomUUID).list().ofMinSize(0).ofMaxSize(15).uniqueElements();
    }

    private DriverService serviceWith(Map<UUID, Driver> byUserId) {
        DriverRepository repo = mock(DriverRepository.class);
        when(repo.findByUserId(any(UUID.class)))
                .thenAnswer(inv -> Optional.ofNullable(byUserId.get(inv.<UUID>getArgument(0))));
        return new DriverService(
                repo, mock(VehicleRepository.class), mock(UserServiceClient.class), mock(DriverProfileCache.class));
    }

    @Property(tries = 100)
    void lookupReturnsExactlyTheMatchingDriver(
            @ForAll("distinctUserIds") List<UUID> userIds, @ForAll int pick) {
        Map<UUID, Driver> byUserId = new HashMap<>();
        for (UUID uid : userIds) {
            byUserId.put(uid, new Driver(UUID.randomUUID(), uid, "LIC-" + UUID.randomUUID(), Instant.now()));
        }
        DriverService service = serviceWith(byUserId);

        // Present case: any id drawn from the set.
        if (!userIds.isEmpty()) {
            UUID target = userIds.get(Math.floorMod(pick, userIds.size()));
            PageResponse<DriverResponse> page = service.listDrivers(20, 0, null, target);
            assertThat(page.items()).hasSize(1);
            assertThat(page.total()).isEqualTo(1L);
            assertThat(page.items().get(0).userId()).isEqualTo(target);
            assertThat(page.items().get(0).id()).isEqualTo(byUserId.get(target).getId());
        }

        // Absent case: a fresh id not in the set.
        UUID absent = UUID.randomUUID();
        assertThat(Set.copyOf(userIds)).doesNotContain(absent);
        PageResponse<DriverResponse> empty = service.listDrivers(20, 0, null, absent);
        assertThat(empty.items()).isEmpty();
        assertThat(empty.total()).isZero();
    }
}
