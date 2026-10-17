-- V1: schema owned by Flyway. Validated against JPA entities (ddl-auto: validate).
-- Versioned and permanent. Do NOT edit after it has run; add a new V2__ instead.

CREATE TABLE IF NOT EXISTS trips (
    id uuid PRIMARY KEY,
    passenger_id uuid NOT NULL,
    driver_id uuid,
    vehicle_id uuid,
    ride_type varchar(255) NOT NULL,
    pickup_lat numeric(9,6) NOT NULL,
    pickup_lng numeric(9,6) NOT NULL,
    pickup_address varchar(255),
    destination_lat numeric(9,6) NOT NULL,
    destination_lng numeric(9,6) NOT NULL,
    destination_address varchar(255),
    status varchar(255) NOT NULL,
    estimated_fare numeric(12,2),
    final_fare numeric(12,2),
    cancellation_reason varchar(255),
    version bigint NOT NULL,
    requested_at timestamptz NOT NULL,
    accepted_at timestamptz,
    arrived_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS trip_offers (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    status varchar(255) NOT NULL,
    distance_meters integer,
    offered_at timestamptz NOT NULL,
    responded_at timestamptz,
    expires_at timestamptz,
    CONSTRAINT uq_trip_offers_trip_driver UNIQUE (trip_id, driver_id)
);
