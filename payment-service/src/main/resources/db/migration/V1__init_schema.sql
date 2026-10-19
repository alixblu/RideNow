-- V1: schema owned by Flyway. Validated against JPA entities (ddl-auto: validate).
-- Versioned and permanent. Do NOT edit after it has run; add a new V2__ instead.
-- Mirrors the `payments` table in docs/database/ridenow.dbml.

CREATE TABLE IF NOT EXISTS payments (
    id uuid PRIMARY KEY,
    trip_id uuid NOT NULL UNIQUE,
    amount numeric(12,2) NOT NULL,
    currency varchar(3) NOT NULL,
    method varchar(255) NOT NULL,
    status varchar(255) NOT NULL,
    idempotency_key varchar(255) NOT NULL UNIQUE,
    failure_reason varchar(255),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    paid_at timestamptz,
    failed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (status);
