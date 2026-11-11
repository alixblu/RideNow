package cloudnative.microservices.realtime.config;

import cloudnative.microservices.realtime.websocket.InboundGuardInterceptor;
import cloudnative.microservices.realtime.websocket.SessionRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.socket.handler.WebSocketHandlerDecorator;

/**
 * STOMP over a plain WebSocket at {@code /ws}. Notifications go out on
 * {@code /topic/users/{userId}} through the in-memory simple broker; clients only
 * receive (see {@link InboundGuardInterceptor}).
 *
 * Production-minded settings: heartbeats both ways so dead sockets are reaped, a
 * cap on the size of any frame a client sends, a bounded send buffer so a slow
 * client cannot pile up memory, and a registry so shutdown can ask clients to
 * reconnect.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final GatewayProperties properties;
    private final InboundGuardInterceptor inboundGuard;
    private final SessionRegistry sessionRegistry;

    public WebSocketConfig(GatewayProperties properties, InboundGuardInterceptor inboundGuard,
                           SessionRegistry sessionRegistry) {
        this.properties = properties;
        this.inboundGuard = inboundGuard;
        this.sessionRegistry = sessionRegistry;
    }

    /** Runs the STOMP heartbeats; the simple broker needs a scheduler to send/expect them. */
    @Bean
    ThreadPoolTaskScheduler brokerHeartbeatScheduler() {
        ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("ws-heartbeat-");
        return scheduler;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(properties.allowedOrigins().toArray(String[]::new));
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        long heartbeat = properties.heartbeat().toMillis();
        registry.enableSimpleBroker("/topic")
                .setHeartbeatValue(new long[] {heartbeat, heartbeat})
                .setTaskScheduler(brokerHeartbeatScheduler());
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(inboundGuard);
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        registration
                .setMessageSizeLimit(properties.maxMessageBytes())
                .setSendBufferSizeLimit(512 * 1024)
                .setSendTimeLimit(10_000)
                .addDecoratorFactory(this::trackSessions);
    }

    /** Keeps the registry and the guard's per-connection state in step with open sockets. */
    private WebSocketHandler trackSessions(WebSocketHandler handler) {
        return new WebSocketHandlerDecorator(handler) {
            @Override
            public void afterConnectionEstablished(WebSocketSession session) throws Exception {
                sessionRegistry.add(session);
                super.afterConnectionEstablished(session);
            }

            @Override
            public void afterConnectionClosed(WebSocketSession session, CloseStatus closeStatus) throws Exception {
                sessionRegistry.remove(session);
                inboundGuard.forget(session.getId());
                super.afterConnectionClosed(session, closeStatus);
            }
        };
    }
}
