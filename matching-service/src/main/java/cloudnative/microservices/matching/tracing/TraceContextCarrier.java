package cloudnative.microservices.matching.tracing;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.propagation.TextMapGetter;
import io.opentelemetry.context.propagation.TextMapPropagator;
import io.opentelemetry.context.propagation.TextMapSetter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Maps between an OpenTelemetry {@link Context} and string message attributes (SNS/SQS).
 * Only {@code traceparent} and {@code X-Amzn-Trace-Id} are ever written. Never throws.
 */
public final class TraceContextCarrier {

    public static final String TRACEPARENT = "traceparent";
    public static final String XRAY = "X-Amzn-Trace-Id";
    public static final Set<String> KEYS = Set.of(TRACEPARENT, XRAY);

    private static final Logger log = LoggerFactory.getLogger(TraceContextCarrier.class);

    private static final TextMapSetter<Map<String, String>> SETTER = (carrier, key, value) -> {
        if (carrier != null && key != null && value != null) {
            carrier.put(key, value);
        }
    };

    private static final TextMapGetter<Map<String, String>> GETTER = new TextMapGetter<>() {
        @Override
        public Iterable<String> keys(Map<String, String> carrier) {
            return carrier == null ? Collections.emptyList() : carrier.keySet();
        }

        @Override
        public String get(Map<String, String> carrier, String key) {
            return carrier == null || key == null ? null : carrier.get(key);
        }
    };

    private final TextMapPropagator propagator;

    public TraceContextCarrier(TextMapPropagator propagator) {
        this.propagator = propagator;
    }

    /** Injects the given context and returns only the allow-listed keys. Empty on failure. */
    public Map<String, String> inject(Context context) {
        Map<String, String> result = new LinkedHashMap<>();
        try {
            Map<String, String> raw = new LinkedHashMap<>();
            propagator.inject(context == null ? Context.current() : context, raw, SETTER);
            for (String key : KEYS) {
                String value = raw.get(key);
                if (value != null && !value.isBlank()) {
                    result.put(key, value);
                }
            }
        } catch (RuntimeException | LinkageError e) {
            log.warn("Failed to inject trace context, publishing without it: {}", e.toString());
            return new LinkedHashMap<>();
        }
        return result;
    }

    /** Extracts a context from the attributes, or {@link Context#root()} when nothing valid is found. */
    public Context extract(Map<String, String> attributes) {
        try {
            if (attributes == null || attributes.isEmpty()) {
                return Context.root();
            }
            Map<String, String> filtered = new LinkedHashMap<>();
            for (String key : KEYS) {
                String value = attributes.get(key);
                if (value != null) {
                    filtered.put(key, value);
                }
            }
            if (filtered.isEmpty()) {
                return Context.root();
            }
            Context extracted = propagator.extract(Context.root(), filtered, GETTER);
            return extracted == null ? Context.root() : extracted;
        } catch (RuntimeException | LinkageError e) {
            log.warn("Failed to extract trace context, starting a new trace: {}", e.toString());
            return Context.root();
        }
    }

    /** True when the attributes carried at least one trace key but the extracted context has no valid span. */
    public boolean isMalformed(Map<String, String> attributes, Context extracted) {
        try {
            if (attributes == null || KEYS.stream().noneMatch(attributes::containsKey)) {
                return false;
            }
            return extracted == null || !Span.fromContext(extracted).getSpanContext().isValid();
        } catch (RuntimeException e) {
            log.warn("Failed to check trace context: {}", e.toString());
            return true;
        }
    }
}
