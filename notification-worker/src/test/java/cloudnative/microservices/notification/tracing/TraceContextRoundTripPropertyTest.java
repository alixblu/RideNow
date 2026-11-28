package cloudnative.microservices.notification.tracing;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapPropagator;
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

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

// Feature: xray-tracing, Property 1: Trace context round trip
// **Validates: Requirements 4.1, 4.3, 4.7, 4.9**
class TraceContextRoundTripPropertyTest {

    private static final TextMapPropagator PROPAGATOR = TextMapPropagator.composite(
            W3CTraceContextPropagator.getInstance(), AwsXrayPropagator.getInstance());

    private static final TraceContextCarrier CARRIER = new TraceContextCarrier(PROPAGATOR);

    @Provide
    Arbitrary<SpanContext> spanContexts() {
        Arbitrary<String> traceIds = Arbitraries.strings().withCharRange('0', '9').withCharRange('a', 'f')
                .ofLength(32).filter(s -> !s.equals("0".repeat(32)));
        Arbitrary<String> spanIds = Arbitraries.strings().withCharRange('0', '9').withCharRange('a', 'f')
                .ofLength(16).filter(s -> !s.equals("0".repeat(16)));
        Arbitrary<Boolean> sampled = Arbitraries.of(true, false);
        return Combinators.combine(traceIds, spanIds, sampled).as((t, s, smp) ->
                SpanContext.create(t, s, smp ? TraceFlags.getSampled() : TraceFlags.getDefault(),
                        TraceState.getDefault()));
    }

    @Property(tries = 200)
    void injectThenExtractRoundTrips(@ForAll("spanContexts") SpanContext sc) {
        Context ctx = Context.root().with(Span.wrap(sc));

        Map<String, String> injected = CARRIER.inject(ctx);
        assertThat(injected.keySet()).isEqualTo(Set.of("traceparent", "X-Amzn-Trace-Id"));

        SpanContext extracted = Span.fromContext(CARRIER.extract(injected)).getSpanContext();
        assertThat(extracted.isValid()).isTrue();
        assertThat(extracted.getTraceId()).isEqualTo(sc.getTraceId());
        assertThat(extracted.getSpanId()).isEqualTo(sc.getSpanId());
        assertThat(extracted.isSampled()).isEqualTo(sc.isSampled());
    }

    @Property(tries = 200)
    void consumerSpanHasExtractedTraceAndParent(@ForAll("spanContexts") SpanContext sc) throws Exception {
        // Sampled parent so the SDK's parent-based default sampler records the child span.
        SpanContext parent = SpanContext.create(sc.getTraceId(), sc.getSpanId(),
                TraceFlags.getSampled(), TraceState.getDefault());
        InMemorySpanExporter exporter = InMemorySpanExporter.create();
        try (SdkTracerProvider provider = SdkTracerProvider.builder()
                .addSpanProcessor(SimpleSpanProcessor.create(exporter)).build()) {
            OpenTelemetrySdk otel = OpenTelemetrySdk.builder().setTracerProvider(provider).build();
            MessagingTracer tracer = new MessagingTracer(otel, CARRIER);

            Map<String, String> attrs = CARRIER.inject(Context.root().with(Span.wrap(parent)));
            tracer.consume("test-queue", "msg-1", attrs, "TripRequested", () -> { });

            List<SpanData> spans = exporter.getFinishedSpanItems();
            assertThat(spans).hasSize(1);
            assertThat(spans.get(0).getTraceId()).isEqualTo(parent.getTraceId());
            assertThat(spans.get(0).getParentSpanId()).isEqualTo(parent.getSpanId());
        }
    }
}
