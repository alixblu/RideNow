package cloudnative.microservices.realtime.service;

import cloudnative.microservices.realtime.config.GatewayProperties;
import cloudnative.microservices.realtime.dto.Pairing;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * A short-lived cache in front of the driver-to-trip lookup. Every driver posts a
 * position about once a second, so without it every position would cost a Redis
 * read. A found pairing is cached for {@code pairingCacheTtl} (~5s); "no pairing"
 * is cached for the shorter {@code negativeCacheTtl}, so a driver who has just been
 * paired is not ignored for long.
 */
@Component
public class PairingCache {

    private record Entry(Optional<Pairing> pairing, long expiresAtNanos) {
    }

    private final PairingStore store;
    private final GatewayProperties properties;
    private final LongSupplier nanoClock;
    private final Map<UUID, Entry> byDriver = new ConcurrentHashMap<>();

    @Autowired
    public PairingCache(PairingStore store, GatewayProperties properties) {
        this(store, properties, System::nanoTime);
    }

    PairingCache(PairingStore store, GatewayProperties properties, LongSupplier nanoClock) {
        this.store = store;
        this.properties = properties;
        this.nanoClock = nanoClock;
    }

    public Optional<Pairing> findByDriver(UUID driverId) {
        long now = nanoClock.getAsLong();
        Entry cached = byDriver.get(driverId);
        if (cached != null && now - cached.expiresAtNanos() < 0) {
            return cached.pairing();
        }
        Optional<Pairing> found = store.findByDriver(driverId);
        long ttl = (found.isPresent() ? properties.pairingCacheTtl() : properties.negativeCacheTtl()).toNanos();
        byDriver.put(driverId, new Entry(found, now + ttl));
        return found;
    }

    /** Forgets every cached pairing for the trip (it ended). */
    public void evictTrip(UUID tripId) {
        byDriver.values().removeIf(e -> e.pairing().map(p -> p.tripId().equals(tripId)).orElse(false));
    }
}
