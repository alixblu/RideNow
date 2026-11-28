package cloudnative.microservices.trip.tracing;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Scope;
import net.jqwik.api.Arbitraries;
import net.jqwik.api.Arbitrary;
import net.jqwik.api.ForAll;
import net.jqwik.api.Property;
import net.jqwik.api.Provide;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TraceIdResponseFilterPropertyTest {

    @RestController
    static class PingController {
        @GetMapping("/ping")
        String ping() {
            return "ok";
        }
    }

    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new PingController())
            .addFilters(new TraceIdResponseFilter())
            .build();

    @Provide
    Arbitrary<String> traceIds() {
        return Arbitraries.strings().withChars("0123456789abcdef").ofLength(32)
                .filter(s -> !s.chars().allMatch(c -> c == '0'));
    }

    @Provide
    Arbitrary<String> spanIds() {
        return Arbitraries.strings().withChars("0123456789abcdef").ofLength(16)
                .filter(s -> !s.chars().allMatch(c -> c == '0'));
    }

    // Feature: xray-tracing, Property 7: Response header carries the trace id
    // **Validates: Requirements 5.6**
    @Property(tries = 100)
    void headerEqualsFormattedTraceIdWhenSpanValid(@ForAll("traceIds") String traceId,
                                                   @ForAll("spanIds") String spanId) throws Exception {
        SpanContext ctx = SpanContext.create(traceId, spanId, TraceFlags.getSampled(), TraceState.getDefault());
        try (Scope ignored = Span.wrap(ctx).makeCurrent()) {
            var result = mvc.perform(get("/ping")).andExpect(status().isOk()).andReturn();
            assertThat(result.getResponse().getHeader(TraceIdResponseFilter.HEADER))
                    .isEqualTo(XrayTraceIds.format(ctx));
        }
    }

    // Feature: xray-tracing, Property 7: Response header carries the trace id
    // **Validates: Requirements 5.6**
    @Property(tries = 100)
    void headerAbsentWhenNoValidSpan(@ForAll("traceIds") String ignoredTraceId) throws Exception {
        var result = mvc.perform(get("/ping")).andExpect(status().isOk()).andReturn();
        assertThat(result.getResponse().getHeader(TraceIdResponseFilter.HEADER)).isNull();
    }
}
