package cloudnative.microservices.matching.entity;

/** Lifecycle of an offer made to a candidate driver (per the DBML). */
public enum TripOfferStatus {
    PENDING,
    ACCEPTED,
    DECLINED,
    EXPIRED
}
