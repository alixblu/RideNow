package cloudnative.microservices.notification;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * notification-worker: an asynchronous consumer of the RideNow notifications SQS
 * queue. It has no business HTTP API (only actuator health); its job is to poll
 * the queue, process each notification once, and let repeated failures flow to
 * the dead-letter queue.
 */
@SpringBootApplication
@EnableScheduling
public class NotificationWorkerApplication {

    public static void main(String[] args) {
        SpringApplication.run(NotificationWorkerApplication.class, args);
    }
}
