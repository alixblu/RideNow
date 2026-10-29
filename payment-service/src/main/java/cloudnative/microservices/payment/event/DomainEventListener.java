package cloudnative.microservices.payment.event;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Bridges Spring in-process application events to the external
 * {@link DomainEventPublisher}, firing only AFTER the surrounding transaction
 * commits - so a rolled-back charge publishes nothing and a transport failure
 * never rolls back committed payment state.
 */
@Component
public class DomainEventListener {

    private final DomainEventPublisher publisher;

    public DomainEventListener(DomainEventPublisher publisher) {
        this.publisher = publisher;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onDomainEvent(DomainEvent event) {
        publisher.publish(event);
    }
}
