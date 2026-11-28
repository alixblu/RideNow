package cloudnative.microservices.driver.tracing;

import ch.qos.logback.classic.pattern.ClassicConverter;
import ch.qos.logback.classic.spi.ILoggingEvent;
import io.opentelemetry.api.trace.Span;

/** Logback converter ({@code %xrayTraceId}): the active trace id in X-Ray format, or "-". */
public class XrayTraceIdConverter extends ClassicConverter {

    @Override
    public String convert(ILoggingEvent event) {
        return XrayTraceIds.format(Span.current().getSpanContext());
    }
}
