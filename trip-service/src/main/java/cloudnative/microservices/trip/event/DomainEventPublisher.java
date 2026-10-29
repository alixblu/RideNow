package cloudnative.microservices.trip.event;

/**
 * Transport-agnostic seam for publishing domain events. The service layer raises
 * events through this interface and never knows the transport, so the local
 * logging stand-in and the AWS EventBridge implementation are interchangeable -
 * the same business code points at either by configuration only.
 */
public interface DomainEventPublisher {

    /** Publishes a single domain event. Must not throw for transport hiccups in a way that breaks the caller. */
    void publish(DomainEvent event);
}
