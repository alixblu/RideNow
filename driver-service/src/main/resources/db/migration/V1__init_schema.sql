-- V1: schema owned by Flyway. Validated against JPA entities (ddl-auto: validate).
-- Versioned and permanent. Do NOT edit after it has run; add a new V2__ instead.

CREATE TABLE IF NOT EXISTS drivers (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE,
    license_number varchar(255) NOT NULL UNIQUE,
    status varchar(255) NOT NULL,
    average_rating numeric(3,2),
    total_trips bigint NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
    id uuid PRIMARY KEY,
    driver_id uuid NOT NULL,
    plate_number varchar(255) NOT NULL UNIQUE,
    vehicle_type varchar(255) NOT NULL,
    brand varchar(255),
    model varchar(255),
    color varchar(255),
    active boolean NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
