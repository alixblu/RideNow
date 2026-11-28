package cloudnative.microservices.notification.service;

import static org.assertj.core.api.Assertions.assertThat;

import cloudnative.microservices.notification.tracing.MessagingTracer;
import cloudnative.microservices.notification.tracing.TraceContextCarrier;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.context.propagation.TextMapPropagator;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageRequest;
import software.amazon.awssdk.services.sqs.model.ReceiveMessageResponse;
import tools.jackson.databind.ObjectMapper;

/** The poller asks SQS to return both trace-context message attributes (Requirements 4.10). */
class NotificationQueueConsumerTest {

    @Test
    void receiveRequestAsksForBothTraceMessageAttributes() {
        AtomicReference<ReceiveMessageRequest> captured = new AtomicReference<>();
        SqsClient stub = (SqsClient) Proxy.newProxyInstance(
                SqsClient.class.getClassLoader(), new Class<?>[]{SqsClient.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("receiveMessage") && args[0] instanceof ReceiveMessageRequest r) {
                        captured.set(r);
                        return ReceiveMessageResponse.builder().build();
                    }
                    if (method.getName().equals("close")) {
                        return null;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
        MessagingTracer tracer = new MessagingTracer(OpenTelemetry.noop(),
                new TraceContextCarrier(TextMapPropagator.noop()));
        NotificationQueueConsumer consumer = new NotificationQueueConsumer(
                stub, null, new ObjectMapper(), tracer, "http://q/notifications", 0, 10);

        consumer.poll();

        assertThat(captured.get()).isNotNull();
        assertThat(captured.get().messageAttributeNames())
                .containsExactlyInAnyOrder("traceparent", "X-Amzn-Trace-Id");
    }
}
