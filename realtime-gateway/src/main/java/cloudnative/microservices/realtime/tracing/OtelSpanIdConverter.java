package cloudnative.microservices.realtime.tracing;

import ch.qos.logback.classic.pattern.ClassicConverter;
import ch.qos.logback.classic.spi.ILoggingEvent;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;

/** Logback converter ({@code %otelSpanId}): the active span id (16 hex), or "-". */
public class OtelSpanIdConverter extends ClassicConverter {

    @Override
    public String convert(ILoggingEvent event) {
        SpanContext ctx = Span.current().getSpanContext();
        return ctx.isValid() ? ctx.getSpanId() : XrayTraceIds.NONE;
    }
}
