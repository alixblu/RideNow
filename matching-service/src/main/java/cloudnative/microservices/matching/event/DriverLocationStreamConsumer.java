package cloudnative.microservices.matching.event;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStreamCommands.XAddOptions;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.PendingMessagesSummary;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.connection.stream.StreamReadOptions;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Reads driver-service's {@code ridenow:stream:driver-locations} stream through a
 * Redis consumer group and feeds each entry to {@link DriverLocationSubscriber}.
 *
 * <p>Why a stream with a group, not Pub/Sub: Pub/Sub drops anything sent while a
 * matching pod is down or reconnecting, which leaves the nearby-driver index stale.
 * Here an entry stays in the stream until some pod acknowledges it, and every entry
 * goes to exactly one pod of the group.
 *
 * <ul>
 *   <li><b>Read.</b> One loop thread runs {@code XREADGROUP} (blocking) and calls the
 *       handler. An entry is acknowledged ({@code XACK}) only after the handler
 *       returned; if it throws (database or Redis down), the entry stays pending.</li>
 *   <li><b>Retry.</b> A scheduled reclaimer takes pending entries idle for longer than
 *       {@code reclaimIdle} (a pod died mid-batch, or the handler failed) and runs
 *       them again, on whichever pod is alive.</li>
 *   <li><b>Dead letter.</b> An entry delivered {@code maxDeliveries} times without
 *       success is copied to a capped dead-letter stream and acknowledged, so one
 *       poison entry cannot loop forever.</li>
 * </ul>
 *
 * Delivery is at-least-once. The handler is idempotent and order-safe
 * ({@link cloudnative.microservices.matching.service.DriverPositionService}).
 */
public class DriverLocationStreamConsumer implements SmartLifecycle {

    /** The single field of a stream entry: the location update JSON. */
    static final String PAYLOAD_FIELD = "payload";

    private static final Logger log = LoggerFactory.getLogger(DriverLocationStreamConsumer.class);

    private static final long ERROR_BACKOFF_MS = 1_000;

    /** Tunables; see {@code ridenow.matching.location-subscriber.*} in application.yaml. */
    public record Settings(
            String streamKey,
            String group,
            String consumerName,
            int batchSize,
            Duration blockTimeout,
            Duration reclaimIdle,
            Duration reclaimInterval,
            int maxDeliveries,
            String deadLetterKey,
            long deadLetterMaxLength) {
    }

    private final StringRedisTemplate redis;
    private final DriverLocationSubscriber subscriber;
    private final Settings settings;

    private volatile boolean running;
    private volatile boolean groupReady;
    private Thread readerThread;
    private ScheduledExecutorService reclaimer;

    public DriverLocationStreamConsumer(StringRedisTemplate redis, DriverLocationSubscriber subscriber,
                                        Settings settings) {
        this.redis = redis;
        this.subscriber = subscriber;
        this.settings = settings;
    }

    private StreamOperations<String, String, String> ops() {
        return redis.opsForStream();
    }

    // ---- lifecycle ---------------------------------------------------------

    @Override
    public synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        readerThread = new Thread(this::readLoop, "driver-location-stream-reader");
        readerThread.setDaemon(true);
        readerThread.start();
        reclaimer = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "driver-location-stream-reclaimer");
            thread.setDaemon(true);
            return thread;
        });
        reclaimer.scheduleWithFixedDelay(this::reclaimSafely, settings.reclaimInterval().toMillis(),
                settings.reclaimInterval().toMillis(), TimeUnit.MILLISECONDS);
        log.info("Consuming {} as {} in group {}", settings.streamKey(), settings.consumerName(), settings.group());
    }

    @Override
    public synchronized void stop() {
        if (!running) {
            return;
        }
        running = false;
        reclaimer.shutdownNow();
        try {
            // The reader is at most one blocking read (blockTimeout) away from noticing.
            readerThread.join(settings.blockTimeout().toMillis() + 3_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        if (readerThread.isAlive()) {
            readerThread.interrupt();
        } else {
            removeConsumerIfIdle();
        }
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    // ---- read loop ---------------------------------------------------------

    private void readLoop() {
        while (running) {
            try {
                if (!groupReady) {
                    ensureGroup();
                }
                pollOnce();
            } catch (RuntimeException e) {
                if (!running) {
                    return;
                }
                if (isMissingGroup(e)) {
                    groupReady = false; // the stream or group was lost (e.g. a cache flush)
                }
                log.warn("Reading {} failed, retrying: {}", settings.streamKey(), e.getMessage());
                sleepQuietly(ERROR_BACKOFF_MS);
            }
        }
    }

    /**
     * Creates the consumer group (and the stream, if it does not exist yet). A new group
     * starts at the beginning of the stream (`0-0`), so entries driver-service wrote
     * before matching first started (driver-service is deployed first) are not skipped.
     * Replaying them is safe: the handler ignores anything not newer than what it
     * holds. An existing group is left alone.
     */
    void ensureGroup() {
        try {
            ops().createGroup(settings.streamKey(), ReadOffset.from("0-0"), settings.group());
        } catch (RuntimeException e) {
            if (!isBusyGroup(e)) {
                throw e;
            }
        }
        groupReady = true;
    }

    /** One blocking read of up to {@code batchSize} new entries, each handled and acked. */
    int pollOnce() {
        List<MapRecord<String, String, String>> records = ops().read(
                Consumer.from(settings.group(), settings.consumerName()),
                StreamReadOptions.empty().count(settings.batchSize()).block(settings.blockTimeout()),
                StreamOffset.create(settings.streamKey(), ReadOffset.lastConsumed()));
        if (records == null) {
            return 0;
        }
        records.forEach(this::process);
        return records.size();
    }

    /** Handles one entry. On any failure the entry is left pending for the reclaimer. */
    private void process(MapRecord<String, String, String> record) {
        String payload = record.getValue().get(PAYLOAD_FIELD);
        try {
            if (payload == null) {
                log.warn("Dropping stream entry {} without a payload", record.getId());
            } else {
                subscriber.onMessage(payload);
            }
            ops().acknowledge(settings.streamKey(), settings.group(), record.getId());
        } catch (RuntimeException e) {
            log.warn("Handling stream entry {} failed, it stays pending for a retry: {}",
                    record.getId(), e.getMessage());
        }
    }

    // ---- reclaim, retry, dead letter ----------------------------------------

    private void reclaimSafely() {
        try {
            int handled = reclaimOnce();
            PendingMessagesSummary summary = ops().pending(settings.streamKey(), settings.group());
            if (handled > 0 || (summary != null && summary.getTotalPendingMessages() > 0)) {
                log.info("{}: reclaimed {} entries, {} still pending", settings.streamKey(), handled,
                        summary == null ? 0 : summary.getTotalPendingMessages());
            }
        } catch (RuntimeException e) {
            log.warn("Reclaiming pending entries of {} failed: {}", settings.streamKey(), e.getMessage());
        }
    }

    /**
     * Takes pending entries idle for longer than {@code reclaimIdle} (whoever held them)
     * and runs them again, or dead-letters those that already used up their deliveries.
     *
     * @return how many entries were taken over
     */
    int reclaimOnce() {
        if (!groupReady) {
            return 0;
        }
        PendingMessages pending = ops().pending(settings.streamKey(), settings.group(), Range.unbounded(),
                settings.batchSize(), settings.reclaimIdle());
        if (pending == null || pending.isEmpty()) {
            return 0;
        }
        Map<RecordId, Long> deliveries = new HashMap<>();
        for (PendingMessage message : pending) {
            deliveries.put(message.getId(), message.getTotalDeliveryCount());
        }
        List<MapRecord<String, String, String>> claimed = ops().claim(settings.streamKey(), settings.group(),
                settings.consumerName(), settings.reclaimIdle(), deliveries.keySet().toArray(RecordId[]::new));
        for (MapRecord<String, String, String> record : claimed) {
            long delivered = deliveries.getOrDefault(record.getId(), 1L);
            if (delivered >= settings.maxDeliveries()) {
                deadLetter(record, delivered);
            } else {
                process(record);
            }
        }
        return claimed.size();
    }

    private void deadLetter(MapRecord<String, String, String> record, long delivered) {
        try {
            Map<String, String> entry = new HashMap<>(record.getValue());
            entry.put("originalId", record.getId().getValue());
            entry.put("deliveries", Long.toString(delivered));
            ops().add(StreamRecords.string(entry).withStreamKey(settings.deadLetterKey()),
                    XAddOptions.maxlen(settings.deadLetterMaxLength()).approximateTrimming(true));
            ops().acknowledge(settings.streamKey(), settings.group(), record.getId());
            log.error("Entry {} failed {} times, moved to {}", record.getId(), delivered, settings.deadLetterKey());
        } catch (RuntimeException e) {
            log.warn("Dead-lettering entry {} failed, it stays pending: {}", record.getId(), e.getMessage());
        }
    }

    // ---- helpers -----------------------------------------------------------

    /**
     * On a clean shutdown, forget this pod's consumer (pod names change every deploy,
     * so they would pile up in the group). Only when it holds nothing pending: deleting
     * a consumer also drops its pending entries.
     */
    private void removeConsumerIfIdle() {
        try {
            Consumer self = Consumer.from(settings.group(), settings.consumerName());
            PendingMessages mine = ops().pending(settings.streamKey(), self, Range.unbounded(), 1);
            if (mine == null || mine.isEmpty()) {
                ops().deleteConsumer(settings.streamKey(), self);
            }
        } catch (RuntimeException e) {
            log.debug("Could not remove consumer {}: {}", settings.consumerName(), e.getMessage());
        }
    }

    private static boolean isBusyGroup(Throwable e) {
        return messageChainContains(e, "BUSYGROUP");
    }

    private static boolean isMissingGroup(Throwable e) {
        return messageChainContains(e, "NOGROUP");
    }

    private static boolean messageChainContains(Throwable e, String text) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t.getMessage() != null && t.getMessage().contains(text)) {
                return true;
            }
        }
        return false;
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
