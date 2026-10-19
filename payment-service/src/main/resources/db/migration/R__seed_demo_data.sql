-- Repeatable demo-data seed. Re-runs whenever this file''s checksum changes.
-- Idempotent via ON CONFLICT DO NOTHING, so re-running is safe. Not for production.
-- trip_id values are logical references to trip-service; kept as plain UUIDs.

INSERT INTO payments (id, trip_id, amount, currency, method, status, idempotency_key, created_at, updated_at, paid_at) VALUES ('55555555-5555-5555-5555-000000000001', '44444444-4444-4444-4444-000000000001', 45000.00, 'VND', 'CASH', 'PAID', 'seed-idem-0001', now(), now(), now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO payments (id, trip_id, amount, currency, method, status, idempotency_key, created_at, updated_at, paid_at) VALUES ('55555555-5555-5555-5555-000000000002', '44444444-4444-4444-4444-000000000002', 72000.00, 'VND', 'SIMULATED_CARD', 'PAID', 'seed-idem-0002', now(), now(), now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO payments (id, trip_id, amount, currency, method, status, idempotency_key, created_at, updated_at) VALUES ('55555555-5555-5555-5555-000000000003', '44444444-4444-4444-4444-000000000003', 38000.00, 'VND', 'CASH', 'PENDING', 'seed-idem-0003', now(), now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO payments (id, trip_id, amount, currency, method, status, idempotency_key, failure_reason, created_at, updated_at, failed_at) VALUES ('55555555-5555-5555-5555-000000000004', '44444444-4444-4444-4444-000000000004', 91000.00, 'VND', 'SIMULATED_CARD', 'FAILED', 'seed-idem-0004', 'Simulated gateway decline', now(), now(), now()) ON CONFLICT (id) DO NOTHING;
