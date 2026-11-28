package cloudnative.microservices.trip.tracing;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.context.propagation.TextMapPropagator;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.contrib.awsxray.propagator.AwsXrayPropagator;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Feature: xray-tracing, Property 2: Missing or malformed context starts a new trace and processing continues.
 *
 * <p><b>Validates: Requirements 4.4, 4.5</b>
 */
class MessagingTracerNoContextPropertyTest {

    private static final InMemorySpanExporter EXPORTER = InMemorySpanExporter.create();
    private static final TraceContextCarrier CARRIER = new TraceContextCarrier(
            TextMapPropagator.composite(W3CTraceContextPropagator.getInstance(), AwsXrayPropagator.getInstance()));
    private static final MessagingTracer TRACER = new MessagingTracer(
            OpenTelemetrySdk.builder()
                    .setTracerProvider(SdkTracerProvider.builder()
                            .addSpanProcessor(SimpleSpanProcessor.create(EXPORTER)).build())
                    .build(),
            CARRIER);

    private static final ch.qos.logback.classic.Logger LOGGER =
            (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(MessagingTracer.class);

    @Provide
    Arbitrary<String> queueNames() {
        return Arbitraries.strings().alpha().numeric().withChars('-', '_').ofMinLength(3).ofMaxLength(24)
                .map(s -> "q-" + s);
    }

    @Provide
    Arbitrary<Map<String, String>> unrelatedAttributes() {
        Arbitrary<String> keys = Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(12)
                .filter(k -> !TraceContextCarrier.KEYS.contains(k));
        return Arbitraries.maps(keys, Arbitraries.strings().ofMaxLength(40)).ofMaxSize(5);
    }

    @Provide
    Arbitrary<Map<String, String>> invalidTraceAttributes() {
        Arbitrary<String> junk = Arbitraries.strings().ofMaxLength(60);
        Arbitrary<String> maybeJunk = junk.injectNull(0.3);
        return Combinators.combine(unrelatedAttributes(), maybeJunk, maybeJunk, Arbitraries.of(0, 1, 2))
                .as((others, tp, xr, mode) -> {
                    Map<String, String> m = new HashMap<>(others);
                    // mode 0: both, 1: only traceparent, 2: only X-Amzn-Trace-Id (junk is never a valid context)
                    if (mode != 2) {
                        m.put(TraceContextCarrier.TRACEPARENT, tp == null ? "" : tp);
                    }
                    if (mode != 1) {
                        m.put(TraceContextCarrier.XRAY, xr == null ? "" : xr);
                    }
                    return m;
                })
                .filter(m -> !validContext(m));
    }

    private static boolean validContext(Map<String, String> attrs) {
        return io.opentelemetry.api.trace.Span.fromContext(CARRIER.extract(attrs)).getSpanContext().isValid();
    }

    @Property(tries = 200)
    void noTraceKeysStartsRootTraceSilently(@ForAll("queueNames") String queue,
                                            @ForAll("unrelatedAttributes") Map<String, String> attrs) throws Exception {
        Result r = run(queue, attrs);
        assertNewRootTrace(r);
        assertThat(r.warnings).as("no warning when there are no trace keys").isEmpty();
    }

    @Property(tries = 200)
    void nullAttributesStartRootTraceSilently(@ForAll("queueNames") String queue) throws Exception {
        Result r = run(queue, null);
        assertNewRootTrace(r);
        assertThat(r.warnings).isEmpty();
    }

    @Property(tries = 200)
    void invalidTraceKeysStartRootTraceAndWarnWithQueueName(
            @ForAll("queueNames") String queue,
            @ForAll("invalidTraceAttributes") Map<String, String> attrs) throws Exception {
        Result r = run(queue, attrs);
        assertNewRootTrace(r);
        assertThat(r.warnings).hasSize(1);
        assertThat(r.warnings.get(0)).contains(queue);
    }

    private static void assertNewRootTrace(Result r) {
        assertThat(r.handlerRuns).isEqualTo(1);
        assertThat(r.spans).hasSize(1);
        SpanData span = r.spans.get(0);
        assertThat(span.getParentSpanContext().isValid()).as("root span").isFalse();
        SpanContext sc = span.getSpanContext();
        assertThat(sc.isValid()).isTrue();
        assertThat(sc.getTraceId()).isNotEqualTo("00000000000000000000000000000000");
    }

    private record Result(int handlerRuns, List<SpanData> spans, List<String> warnings) {
    }

    private static Result run(String queue, Map<String, String> attrs) throws Exception {
        EXPORTER.reset();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        LOGGER.addAppender(appender);
        AtomicInteger runs = new AtomicInteger();
        try {
            TRACER.consume(queue, "msg-1", attrs, "TripRequested", runs::incrementAndGet);
        } finally {
            LOGGER.detachAppender(appender);
            appender.stop();
        }
        List<String> warnings = appender.list.stream()
                .filter(e -> e.getLevel() == Level.WARN)
                .map(ILoggingEvent::getFormattedMessage)
                .toList();
        return new Result(runs.get(), EXPORTER.getFinishedSpanItems(), warnings);
    }
}
