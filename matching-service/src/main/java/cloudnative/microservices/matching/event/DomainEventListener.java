package cloudnative.microservices.matching.event;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Bridges Spring's in-process application events to the external
 * {@link DomainEventPublisher}, firing only AFTER the surrounding database
 * transaction commits: a rolled-back match publishes nothing, and a transport
 * failure never rolls back already-committed offers.
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
