-- V2: the user-readable inbox. One row per recipient per domain event.
-- user_id and trip_id are logical references to other services (no foreign keys).
-- unique (event_id, user_id) makes a redelivered event add nothing.
CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    event_id uuid NOT NULL,
    type varchar(100) NOT NULL,
    message varchar(500) NOT NULL,
    trip_id uuid,
    occurred_at timestamptz,
    created_at timestamptz NOT NULL,
    read_at timestamptz,
    CONSTRAINT uq_notifications_event_user UNIQUE (event_id, user_id)
);

-- Serves "this user's notifications after a cursor", ordered by (created_at, id).
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at, id);
