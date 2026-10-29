package cloudnative.microservices.payment.event;

/**
 * Transport-agnostic seam for publishing domain events. The service layer raises
 * events through this interface; the local logging stand-in and the AWS
 * EventBridge implementation are interchangeable by configuration only.
 */
public interface DomainEventPublisher {

    void publish(DomainEvent event);
}
