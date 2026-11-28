package cloudnative.microservices.notification.tracing;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Adds {@code X-Trace-Id} (X-Ray format) to every response that is handled inside a valid span,
 * so a tester can find the trace of one call. Sets no header without a valid span (no agent).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TraceIdResponseFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Trace-Id";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        SpanContext ctx = Span.current().getSpanContext();
        if (ctx.isValid()) {
            response.setHeader(HEADER, XrayTraceIds.format(ctx));
        }
        chain.doFilter(request, response);
    }
}
