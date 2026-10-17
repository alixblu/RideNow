-- V1: schema owned by Flyway. Validated against JPA entities (ddl-auto: validate).
-- Versioned and permanent. Do NOT edit after it has run; add a new V2__ instead.

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    cognito_sub varchar(255) NOT NULL UNIQUE,
    email varchar(255) NOT NULL UNIQUE,
    phone varchar(255) UNIQUE,
    full_name varchar(255) NOT NULL,
    avatar_url varchar(255),
    status varchar(255) NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
