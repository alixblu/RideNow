package cloudnative.microservices.payment.event;

import cloudnative.microservices.payment.tracing.MessagingTracer;
import cloudnative.microservices.payment.tracing.TraceContextCarrier;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.context.propagation.TextMapPropagator;
import io.opentelemetry.contrib.awsxray.propagator.AwsXrayPropagator;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.Combinators;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.MessageAttributeValue;
import software.amazon.awssdk.services.sns.model.PublishRequest;
import software.amazon.awssdk.services.sns.model.PublishResponse;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Feature: xray-tracing, Property 4: Publishing keeps the payload and adds only trace attributes.
 *
 * <p><b>Validates: Requirements 4.8, 3.10</b>
 */
class SnsPublishPayloadPropertyTest {

    private static final String TOPIC_ARN = "arn:aws:sns:ap-southeast-1:000000000000:ridenow-test-events";
    private static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static final TextMapPropagator PROPAGATOR = TextMapPropagator.composite(
            W3CTraceContextPropagator.getInstance(), AwsXrayPropagator.getInstance());

    /** SDK with a real tracer provider and propagators, so a valid span context gets injected. */
    private static final OpenTelemetry TRACING = OpenTelemetrySdk.builder()
            .setTracerProvider(SdkTracerProvider.builder().build())
            .build();

    @Provide
    Arbitrary<DomainEvent> events() {
        Arbitrary<String> types = Arbitraries.of("trip.requested", "trip.accepted", "trip.completed",
                "trip.cancelled", "payment.captured");
        Arbitrary<Map<String, String>> data = Arbitraries.maps(
                Arbitraries.strings().alpha().ofMinLength(1).ofMaxLength(10),
                Arbitraries.strings().ofMaxLength(30)).ofMaxSize(5);
        Arbitrary<Instant> times = Arbitraries.longs().between(0L, 4_000_000_000L).map(Instant::ofEpochSecond);
        return Combinators.combine(types, Arbitraries.integers().between(1, 5), times, data)
                .as((type, version, at, d) ->
                        new DomainEvent(UUID.randomUUID(), type, version, at, UUID.randomUUID(), d));
    }

    @Property(tries = 200)
    void payloadUnchangedAndAttributesOnlyTraceKeys(@ForAll("events") DomainEvent event) {
        PublishRequest noop = publish(event, OpenTelemetry.noop(), TextMapPropagator.noop());
        PublishRequest traced = publish(event, TRACING, PROPAGATOR);

        // Body equals the plain JSON serialization and the no-op run, regardless of tracing.
        assertThat(traced.message()).isEqualTo(noop.message());
        assertThat(traced.message()).isEqualTo(MAPPER.writeValueAsString(event));

        // With a no-op OpenTelemetry nothing is added.
        assertThat(noop.messageAttributes()).isEmpty();

        // With tracing, only the allow-listed keys, all of DataType String.
        Set<String> keys = new HashSet<>(traced.messageAttributes().keySet());
        assertThat(TraceContextCarrier.KEYS).containsAll(keys);
        for (MessageAttributeValue v : traced.messageAttributes().values()) {
            assertThat(v.dataType()).isEqualTo("String");
            assertThat(v.stringValue()).isNotBlank();
        }
    }

    private static PublishRequest publish(DomainEvent event, OpenTelemetry otel, TextMapPropagator propagator) {
        AtomicReference<PublishRequest> captured = new AtomicReference<>();
        SnsClient stub = (SnsClient) Proxy.newProxyInstance(
                SnsClient.class.getClassLoader(), new Class<?>[]{SnsClient.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("publish") && args != null && args[0] instanceof PublishRequest r) {
                        captured.set(r);
                        return PublishResponse.builder().messageId("m-1").build();
                    }
                    if (method.getName().equals("close")) {
                        return null;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
        MessagingTracer tracer = new MessagingTracer(otel, new TraceContextCarrier(propagator));
        new SnsDomainEventPublisher(stub, MAPPER, TOPIC_ARN, tracer).publish(event);
        assertThat(captured.get()).isNotNull();
        return captured.get();
    }
}
