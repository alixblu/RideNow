package cloudnative.microservices.realtime.service;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * The open SSE streams of this pod, grouped by trip. Each pod only knows its own
 * streams; Redis Pub/Sub reaches every pod, and a pod with no stream for a trip
 * simply drops the message.
 *
 * <p>Shutdown completes every stream cleanly. The browser's {@code EventSource}
 * then reconnects after the server's {@code retry:} delay, which is jittered per
 * stream so a pod's clients do not all return at once.
 */
@Component
public class StreamRegistry {

    private static final Logger log = LoggerFactory.getLogger(StreamRegistry.class);

    private final Map<UUID, Deque<SseEmitter>> byTrip = new ConcurrentHashMap<>();

    /**
     * Adds a stream for the trip. If the trip already has {@code maxStreams}, the
     * oldest is completed to make room: it is most likely a dead connection the
     * client has already abandoned.
     */
    public void register(UUID tripId, SseEmitter emitter, int maxStreams) {
        List<SseEmitter> evicted = new ArrayList<>();
        synchronized (this) {
            Deque<SseEmitter> streams = byTrip.computeIfAbsent(tripId, id -> new ArrayDeque<>());
            streams.addLast(emitter);
            while (streams.size() > maxStreams) {
                evicted.add(streams.pollFirst());
            }
        }
        Runnable cleanup = () -> remove(tripId, emitter);
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(e -> cleanup.run());
        evicted.forEach(SseEmitter::complete);
    }

    public boolean hasStreams(UUID tripId) {
        Deque<SseEmitter> streams = byTrip.get(tripId);
        return streams != null && !streams.isEmpty();
    }

    public boolean isEmpty() {
        return byTrip.isEmpty();
    }

    public int streamCount(UUID tripId) {
        Deque<SseEmitter> streams = byTrip.get(tripId);
        return streams == null ? 0 : streams.size();
    }

    public int totalStreams() {
        return byTrip.values().stream().mapToInt(Deque::size).sum();
    }

    /** Sends the event to every stream of the trip; a stream that fails is dropped. */
    public void send(UUID tripId, SseEmitter.SseEventBuilder event) {
        for (SseEmitter emitter : snapshot(tripId)) {
            try {
                emitter.send(event);
            } catch (IOException | RuntimeException e) {
                log.debug("Dropping a broken stream for trip {}: {}", tripId, e.getMessage());
                remove(tripId, emitter);
            }
        }
    }

    /** Sends a final event to every stream of the trip, then completes them. */
    public void end(UUID tripId, SseEmitter.SseEventBuilder finalEvent) {
        List<SseEmitter> streams = snapshot(tripId);
        byTrip.remove(tripId);
        for (SseEmitter emitter : streams) {
            try {
                emitter.send(finalEvent);
            } catch (IOException | RuntimeException e) {
                log.debug("Final event failed for trip {}: {}", tripId, e.getMessage());
            }
            emitter.complete();
        }
    }

    /** A {@code : ping} comment on every stream, so a dead connection is noticed on write. */
    @Scheduled(fixedRateString = "${ridenow.gateway.heartbeat-millis:15000}")
    public void sendHeartbeats() {
        byTrip.keySet().forEach(tripId -> send(tripId, SseEmitter.event().comment("ping")));
    }

    /** Fires at the start of context shutdown, before the web server stops. */
    @EventListener(ContextClosedEvent.class)
    public void onShutdown() {
        closeAll();
    }

    /** Completes every stream on this pod; returns how many were open. */
    public int closeAll() {
        List<SseEmitter> all = new ArrayList<>();
        synchronized (this) {
            byTrip.values().forEach(all::addAll);
            byTrip.clear();
        }
        all.forEach(SseEmitter::complete);
        if (!all.isEmpty()) {
            log.info("Completed {} SSE stream(s) for shutdown", all.size());
        }
        return all.size();
    }

    private List<SseEmitter> snapshot(UUID tripId) {
        Deque<SseEmitter> streams = byTrip.get(tripId);
        if (streams == null) {
            return List.of();
        }
        synchronized (this) {
            return new ArrayList<>(streams);
        }
    }

    private synchronized void remove(UUID tripId, SseEmitter emitter) {
        Deque<SseEmitter> streams = byTrip.get(tripId);
        if (streams == null) {
            return;
        }
        streams.remove(emitter);
        if (streams.isEmpty()) {
            byTrip.remove(tripId);
        }
    }
}
