-- V2: adds password-based auth alongside the existing Cognito-style identity.
-- cognito_sub becomes optional because password accounts have none.
-- Existing rows are kept and backfilled to account_type 'RIDER' by the column DEFAULT.
-- The DEFAULT is kept so repeatable seed inserts that omit account_type still work.
ALTER TABLE users ALTER COLUMN cognito_sub DROP NOT NULL;
ALTER TABLE users ADD COLUMN password_hash varchar(255);
ALTER TABLE users ADD COLUMN account_type varchar(255) NOT NULL DEFAULT 'RIDER';
