package cloudnative.microservices.notification.tracing;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import net.jqwik.api.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class ConsumerSpanPropertyTest {

    @Provide
    Arbitrary<String> names() {
        return Arbitraries.strings().alpha().numeric().withChars('-', '_', '.', ':').ofMinLength(1).ofMaxLength(40);
    }

    // Feature: xray-tracing, Property 3: Consumer span carries queue, message id and event type
    // **Validates: Requirements 4.6**
    @Property(tries = 100)
    void consumerSpanCarriesQueueMessageIdAndEventType(
            @ForAll("names") String queue,
            @ForAll("names") String messageId,
            @ForAll("names") String eventType) throws Exception {
        InMemorySpanExporter exporter = InMemorySpanExporter.create();
        SdkTracerProvider provider = SdkTracerProvider.builder()
                .addSpanProcessor(SimpleSpanProcessor.create(exporter)).build();
        OpenTelemetrySdk otel = OpenTelemetrySdk.builder().setTracerProvider(provider).build();
        try {
            MessagingTracer tracer = new MessagingTracer(otel,
                    new TraceContextCarrier(W3CTraceContextPropagator.getInstance()));
            AtomicInteger handled = new AtomicInteger();

            tracer.consume(queue, messageId, new HashMap<String, String>(), eventType, handled::incrementAndGet);

            assertThat(handled).hasValue(1);
            List<SpanData> spans = exporter.getFinishedSpanItems();
            assertThat(spans).hasSize(1);
            SpanData span = spans.get(0);
            assertThat(span.getKind()).isEqualTo(SpanKind.CONSUMER);
            assertThat(span.getName()).contains(queue).contains(eventType);
            Map<String, Object> attrs = new HashMap<>();
            span.getAttributes().forEach((k, v) -> attrs.put(k.getKey(), v));
            assertThat(attrs.values()).contains(queue, messageId, eventType);
            assertThat(span.getAttributes().get(AttributeKey.stringKey("messaging.destination.name"))).isEqualTo(queue);
            assertThat(span.getAttributes().get(AttributeKey.stringKey("messaging.message.id"))).isEqualTo(messageId);
            assertThat(span.getAttributes().get(AttributeKey.stringKey("ridenow.event.type"))).isEqualTo(eventType);
        } finally {
            provider.close();
        }
    }
}
