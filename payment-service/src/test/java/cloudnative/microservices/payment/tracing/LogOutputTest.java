package cloudnative.microservices.payment.tracing;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.joran.JoranConfigurator;
import ch.qos.logback.classic.spi.LoggingEvent;
import ch.qos.logback.core.ConsoleAppender;
import ch.qos.logback.core.encoder.Encoder;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import io.opentelemetry.sdk.trace.SdkTracerProvider;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Renders a log event through the real {@code logback-spring.xml} (converters and pattern) and checks
 * the trace fields. Requirements 5.1, 5.3.
 */
class LogOutputTest {

    private LoggerContext context;
    private Encoder<ch.qos.logback.classic.spi.ILoggingEvent> encoder;
    private SdkTracerProvider tracerProvider;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() throws Exception {
        context = new LoggerContext();
        URL config = getClass().getClassLoader().getResource("logback-spring.xml");
        assertThat(config).as("logback-spring.xml on classpath").isNotNull();
        JoranConfigurator configurator = new JoranConfigurator();
        configurator.setContext(context);
        configurator.doConfigure(config);
        ConsoleAppender<ch.qos.logback.classic.spi.ILoggingEvent> console =
                (ConsoleAppender<ch.qos.logback.classic.spi.ILoggingEvent>) context.getLogger("ROOT").getAppender("CONSOLE");
        assertThat(console).isNotNull();
        encoder = console.getEncoder();
        assertThat(encoder).isInstanceOf(PatternLayoutEncoder.class);
        tracerProvider = SdkTracerProvider.builder().build();
    }

    @AfterEach
    void tearDown() {
        tracerProvider.close();
        context.stop();
    }

    private String render(String message) {
        LoggingEvent event = new LoggingEvent(
                LogOutputTest.class.getName(), context.getLogger(LogOutputTest.class), Level.INFO, message, null, null);
        return new String(encoder.encode(event), StandardCharsets.UTF_8);
    }

    @Test
    void insideSpanLineHasXrayTraceIdAndSpanId() {
        Tracer tracer = tracerProvider.get("test");
        Span span = tracer.spanBuilder("op").startSpan();
        String line;
        try (Scope ignored = span.makeCurrent()) {
            line = render("hello");
        } finally {
            span.end();
        }
        String traceId = span.getSpanContext().getTraceId();
        String xray = "1-" + traceId.substring(0, 8) + "-" + traceId.substring(8);
        assertThat(line).contains("trace_id=1-");
        assertThat(line).contains("trace_id=" + xray + " ");
        assertThat(line).contains("span_id=" + span.getSpanContext().getSpanId() + " ");
        assertThat(line).contains("hello");
    }

    @Test
    void outsideSpanLineHasDashTraceId() {
        String line = render("no span here");
        assertThat(line).contains("trace_id=-");
        assertThat(line).contains("span_id=-");
        assertThat(line).doesNotContain("trace_id=1-");
        assertThat(line).contains("no span here");
    }
}
