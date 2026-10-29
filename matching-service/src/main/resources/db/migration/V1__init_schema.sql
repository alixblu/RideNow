-- V1: schema owned by Flyway. Validated against JPA entities (ddl-auto: validate).
-- Versioned and permanent. Do NOT edit after it has run; add a new V2__ instead.

-- Offers matching-service makes to candidate drivers (mirrors the DBML).
CREATE TABLE IF NOT EXISTS trip_offers (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL,
    driver_id uuid NOT NULL,
    status varchar(255) NOT NULL,
    distance_meters integer,
    offered_at timestamptz NOT NULL,
    responded_at timestamptz,
    expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_trip_offers_trip_id ON trip_offers (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_offers_driver_id ON trip_offers (driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_offers_status ON trip_offers (status);
CREATE INDEX IF NOT EXISTS idx_trip_offers_expires_at ON trip_offers (expires_at);

-- matching-service's own working copy of candidate driver positions, fed by the
-- driver-service handoff. Used by the boring Postgres nearby query (Task B3).
CREATE TABLE IF NOT EXISTS matching_driver_positions (
    driver_id uuid PRIMARY KEY,
    vehicle_type varchar(255) NOT NULL,
    lat numeric(9,6) NOT NULL,
    lng numeric(9,6) NOT NULL,
    reported_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mdp_vehicle_type ON matching_driver_positions (vehicle_type);
CREATE INDEX IF NOT EXISTS idx_mdp_reported_at ON matching_driver_positions (reported_at);
