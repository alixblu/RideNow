package cloudnative.microservices.ridenow.tracing;

import io.opentelemetry.api.trace.SpanContext;

import java.util.Optional;
import java.util.regex.Pattern;

/** Converts between OpenTelemetry trace ids (32 hex) and X-Ray trace ids ({@code 1-<8 hex>-<24 hex>}). */
public final class XrayTraceIds {

    /** Value used when there is no valid span, so the log format stays stable. */
    public static final String NONE = "-";

    private static final Pattern XRAY_ID = Pattern.compile("^1-([0-9a-f]{8})-([0-9a-f]{24})$");

    private XrayTraceIds() {
    }

    /** "1-" + first 8 hex + "-" + last 24 hex, or "-" when the span context is null or invalid. */
    public static String format(SpanContext ctx) {
        if (ctx == null || !ctx.isValid()) {
            return NONE;
        }
        String id = ctx.getTraceId();
        return "1-" + id.substring(0, 8) + "-" + id.substring(8);
    }

    /** The 32 hex OpenTelemetry trace id for a valid X-Ray id, or empty when the string is not one. */
    public static Optional<String> toOtelTraceId(String xrayId) {
        if (xrayId == null) {
            return Optional.empty();
        }
        var m = XRAY_ID.matcher(xrayId);
        if (!m.matches()) {
            return Optional.empty();
        }
        String id = m.group(1) + m.group(2);
        return id.chars().allMatch(c -> c == '0') ? Optional.empty() : Optional.of(id);
    }
}
