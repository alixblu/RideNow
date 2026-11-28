package cloudnative.microservices.notification.tracing;

import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.propagation.TextMapPropagator;
import io.opentelemetry.api.trace.propagation.W3CTraceContextPropagator;
import io.opentelemetry.contrib.awsxray.propagator.AwsXrayPropagator;
import io.opentelemetry.sdk.OpenTelemetrySdk;
import io.opentelemetry.sdk.testing.exporter.InMemorySpanExporter;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import io.opentelemetry.sdk.trace.data.EventData;
import io.opentelemetry.sdk.trace.data.SpanData;
import io.opentelemetry.sdk.trace.export.SimpleSpanProcessor;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.InvalidParameterException;
import software.amazon.awssdk.services.sns.model.NotFoundException;
import software.amazon.awssdk.services.sns.model.PublishRequest;

import java.lang.reflect.Proxy;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Feature: xray-tracing, Property 5: Publish failures are recorded and rethrown unchanged.
 *
 * <p><b>Validates: Requirements 4.11</b>
 */
class MessagingTracerPublishFailurePropertyTest {

    private static final InMemorySpanExporter EXPORTER = InMemorySpanExporter.create();
    private static final MessagingTracer TRACER = new MessagingTracer(
            OpenTelemetrySdk.builder()
                    .setTracerProvider(SdkTracerProvider.builder()
                            .addSpanProcessor(SimpleSpanProcessor.create(EXPORTER)).build())
                    .build(),
            new TraceContextCarrier(TextMapPropagator.composite(
                    W3CTraceContextPropagator.getInstance(), AwsXrayPropagator.getInstance())));

    @Provide
    Arbitrary<Throwable> snsFailures() {
        Arbitrary<String> msg = Arbitraries.strings().ofMaxLength(60);
        return msg.flatMap(m -> Arbitraries.of(
                SdkClientException.create(m),
                SdkException.create(m, new RuntimeException("cause")),
                InvalidParameterException.builder().message(m).build(),
                NotFoundException.builder().message(m).build(),
                new IllegalStateException(m),
                new RuntimeException(m),
                new OutOfMemoryError(m),
                new StackOverflowError(m)));
    }

    @Provide
    Arbitrary<String> names() {
        return Arbitraries.strings().alpha().numeric().ofMinLength(1).ofMaxLength(20);
    }

    private static SnsClient failingClient(Throwable failure) {
        return (SnsClient) Proxy.newProxyInstance(SnsClient.class.getClassLoader(), new Class<?>[]{SnsClient.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("publish")) {
                        throw failure;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
    }

    @Property(tries = 200)
    void publishRethrowsSameExceptionAndMarksSpanError(@ForAll("snsFailures") Throwable failure,
                                                       @ForAll("names") String topic,
                                                       @ForAll("names") String eventType) {
        EXPORTER.reset();
        SnsClient sns = failingClient(failure);

        Throwable thrown = null;
        try {
            TRACER.publish(topic, eventType, attrs -> sns.publish(
                    PublishRequest.builder().topicArn(topic).message("{}").build()));
        } catch (Throwable t) {
            thrown = t;
        }

        assertThat(thrown).isSameAs(failure);
        List<SpanData> spans = EXPORTER.getFinishedSpanItems();
        assertThat(spans).hasSize(1);
        SpanData span = spans.get(0);
        assertThat(span.hasEnded()).isTrue();
        assertThat(span.getStatus().getStatusCode()).isEqualTo(StatusCode.ERROR);
        List<EventData> events = span.getEvents();
        assertThat(events).anySatisfy(e -> {
            assertThat(e.getName()).isEqualTo("exception");
            assertThat(e.getAttributes().asMap().values()).contains(failure.getClass().getName());
        });
    }
}
