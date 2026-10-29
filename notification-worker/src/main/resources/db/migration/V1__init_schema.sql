-- V1: schema owned by Flyway. Validated against JPA entities (ddl-auto: validate).
-- Versioned and permanent. Do NOT edit after it has run; add a new V2__ instead.

-- The idempotency ledger for consumed notifications. The worker records each
-- event id it has handled so a duplicate SQS delivery (at-least-once) is a no-op.
CREATE TABLE IF NOT EXISTS processed_notifications (
    event_id uuid PRIMARY KEY,
    event_type varchar(255) NOT NULL,
    aggregate_id uuid,
    processed_at timestamptz NOT NULL
);
