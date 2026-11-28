package cloudnative.microservices.payment.tracing;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanBuilder;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.services.sns.model.MessageAttributeValue;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * Explicit PRODUCER / CONSUMER spans around SNS publish and SQS message processing.
 * Uses the OpenTelemetry API only; without the agent everything is a no-op.
 */
public final class MessagingTracer {

    static final String INSTRUMENTATION_NAME = "ridenow-messaging";

    /** Runnable that may throw a checked exception. */
    @FunctionalInterface
    public interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final Logger log = LoggerFactory.getLogger(MessagingTracer.class);

    private final Tracer tracer;
    private final TraceContextCarrier carrier;

    public MessagingTracer(OpenTelemetry otel, TraceContextCarrier carrier) {
        this.tracer = otel.getTracer(INSTRUMENTATION_NAME);
        this.carrier = carrier;
    }

    /**
     * Runs the publish inside a PRODUCER span. The function receives the trace attributes to attach
     * to the message (possibly empty). Exceptions thrown by it are recorded and rethrown unchanged.
     */
    public <T> T publish(String topic, String eventType,
                         Function<Map<String, MessageAttributeValue>, T> sendWithAttributes) {
        Span span = tracer.spanBuilder("ridenow-events publish")
                .setSpanKind(SpanKind.PRODUCER)
                .setAttribute("messaging.system", "aws_sns")
                .setAttribute("messaging.destination.name", topic)
                .setAttribute("ridenow.event.type", eventType)
                .startSpan();
        try (Scope ignored = span.makeCurrent()) {
            Map<String, MessageAttributeValue> attrs = new LinkedHashMap<>();
            for (Map.Entry<String, String> e : carrier.inject(Context.current()).entrySet()) {
                attrs.put(e.getKey(), MessageAttributeValue.builder()
                        .dataType("String").stringValue(e.getValue()).build());
            }
            return sendWithAttributes.apply(attrs);
        } catch (Throwable t) {
            fail(span, t);
            throw t;
        } finally {
            span.end();
        }
    }

    /**
     * Runs the handler inside a CONSUMER span. The parent is the extracted context when valid,
     * otherwise a new trace is started. Handler exceptions are recorded and rethrown unchanged.
     *
     * @param attributes string message attributes of the SQS message (may be null)
     */
    public void consume(String queueName, String messageId, Map<String, String> attributes,
                        String eventType, ThrowingRunnable handler) throws Exception {
        String type = eventType == null || eventType.isBlank() ? "unknown" : eventType;
        Context extracted = carrier.extract(attributes);
        boolean valid = io.opentelemetry.api.trace.Span.fromContext(extracted).getSpanContext().isValid();
        if (carrier.isMalformed(attributes, extracted)) {
            log.warn("Malformed trace context on queue={}, starting new trace", queueName);
        }
        SpanBuilder builder = tracer.spanBuilder(queueName + " process " + type)
                .setSpanKind(SpanKind.CONSUMER)
                .setAttribute("messaging.system", "aws_sqs")
                .setAttribute("messaging.destination.name", queueName)
                .setAttribute("ridenow.event.type", type)
                .setAttribute("messaging.operation", "process");
        if (messageId != null) {
            builder.setAttribute("messaging.message.id", messageId);
        }
        if (valid) {
            builder.setParent(extracted);
        } else {
            builder.setNoParent();
        }
        Span span = builder.startSpan();
        try (Scope ignored = span.makeCurrent()) {
            handler.run();
        } catch (Throwable t) {
            fail(span, t);
            throw t;
        } finally {
            span.end();
        }
    }

    private static void fail(Span span, Throwable t) {
        try {
            span.recordException(t);
            span.setStatus(StatusCode.ERROR);
        } catch (RuntimeException e) {
            log.warn("Failed to record exception on span: {}", e.toString());
        }
    }
}
