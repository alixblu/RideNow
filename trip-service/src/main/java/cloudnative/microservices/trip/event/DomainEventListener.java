package cloudnative.microservices.trip.event;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Bridges Spring's in-process application events to the external
 * {@link DomainEventPublisher}, firing only AFTER the surrounding database
 * transaction commits.
 *
 * Why after-commit: the service raises the event inside its @Transactional
 * method, but we must not tell the outside world "trip completed" if the
 * transaction later rolls back. Deferring the publish to AFTER_COMMIT means a
 * rolled-back change publishes nothing, and a transport failure here never rolls
 * back already-committed business state.
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
