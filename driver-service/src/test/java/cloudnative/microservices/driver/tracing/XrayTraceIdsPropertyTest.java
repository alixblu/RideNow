package cloudnative.microservices.driver.tracing;

import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import net.jqwik.api.*;

import static org.assertj.core.api.Assertions.assertThat;

class XrayTraceIdsPropertyTest {

    private static final String ZERO_TRACE = "0".repeat(32);
    private static final String ZERO_SPAN = "0".repeat(16);

    @Provide
    Arbitrary<String> traceIds() {
        return Arbitraries.strings().withCharRange('0', '9').withCharRange('a', 'f')
                .ofLength(32).filter(s -> !s.equals(ZERO_TRACE));
    }

    @Provide
    Arbitrary<String> spanIds() {
        return Arbitraries.strings().withCharRange('0', '9').withCharRange('a', 'f')
                .ofLength(16).filter(s -> !s.equals(ZERO_SPAN));
    }

    // Feature: xray-tracing, Property 6: X-Ray trace id format and inverse
    // **Validates: Requirements 5.2, 5.3**
    @Property(tries = 200)
    void validContextFormatsAndInverts(@ForAll("traceIds") String traceId, @ForAll("spanIds") String spanId) {
        SpanContext ctx = SpanContext.create(traceId, spanId, TraceFlags.getSampled(), TraceState.getDefault());
        String xray = XrayTraceIds.format(ctx);
        assertThat(xray).matches("^1-[0-9a-f]{8}-[0-9a-f]{24}$");
        assertThat(XrayTraceIds.toOtelTraceId(xray)).contains(traceId);
    }

    // Feature: xray-tracing, Property 6: X-Ray trace id format and inverse
    // **Validates: Requirements 5.2, 5.3**
    @Property(tries = 100)
    void invalidContextYieldsDash(@ForAll("traceIds") String traceId, @ForAll("spanIds") String spanId,
                                  @ForAll boolean zeroTrace) {
        SpanContext ctx = zeroTrace
                ? SpanContext.create(ZERO_TRACE, spanId, TraceFlags.getSampled(), TraceState.getDefault())
                : SpanContext.create(traceId, ZERO_SPAN, TraceFlags.getSampled(), TraceState.getDefault());
        assertThat(XrayTraceIds.format(ctx)).isEqualTo("-");
    }

    @Example
    void allZeroAndNullContextsYieldDash() {
        assertThat(XrayTraceIds.format(SpanContext.getInvalid())).isEqualTo("-");
        assertThat(XrayTraceIds.format(SpanContext.create(ZERO_TRACE, ZERO_SPAN,
                TraceFlags.getDefault(), TraceState.getDefault()))).isEqualTo("-");
        assertThat(XrayTraceIds.format(null)).isEqualTo("-");
    }
}
