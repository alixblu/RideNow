package cloudnative.microservices.driver.live;

/**
 * A driver's live availability for receiving ride offers. This is ephemeral,
 * fast-changing state kept in Redis (NOT the durable account status in Postgres,
 * which is ACTIVE/SUSPENDED). The DBML deliberately keeps this out of the DB.
 */
public enum Availability {
    ONLINE,
    OFFLINE
}
