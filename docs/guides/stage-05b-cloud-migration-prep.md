# Stage 5b - Cloud-migration prep (images + env config + RDS-ready)

> Part: PART 2/3 bridge. Produced during the containerization pass. Covers what
> makes the existing services deployable to AWS without code changes. No live
> AWS resources are created here; this is the "same concept, managed" groundwork
> that Stages 9-13 build on.

This document records the cloud-readiness work already done so the later AWS
stages (RDS, ECR, EKS) are pure substitution, not redesign.

## 1. Externalized configuration (the key enabler)

Every service reads its connection details from environment variables with
local defaults:

```yaml
datasource:
  url: ${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5433/driver_service}
  username: ${SPRING_DATASOURCE_USERNAME:driver}
  password: ${SPRING_DATASOURCE_PASSWORD:driver_local}
```

- Run bare on your laptop with no env vars -> the defaults apply; nothing changed.
- Run under Compose -> the root `docker-compose.yml` injects container-aware values.
- Run on EKS -> a ConfigMap/Secret (or AWS Secrets Manager) injects the same keys.

One image, promoted unchanged from laptop to production. No `dev`/`staging`/`prod`
profile files; the environment supplies the differences. This is the twelve-factor
"config in the environment" rule and the ARCHITECTURE.md "config-driven endpoints"
decision, made concrete.

Variable names (identical across local, Compose, and cloud):

| Variable | Meaning |
|----------|---------|
| `SERVER_PORT` | HTTP port the service listens on |
| `SPRING_DATASOURCE_URL` | JDBC URL of this service's own database |
| `SPRING_DATASOURCE_USERNAME` | DB user |
| `SPRING_DATASOURCE_PASSWORD` | DB password (a Secret in the cloud) |
| `SERVICES_USER_SERVICE_BASE_URL` | driver-service only: where to reach user-service |

## 2. Container images (Stage 5)

Each service has a multi-stage `Dockerfile`:

- Build stage: `eclipse-temurin:25-jdk` + the Maven wrapper build the Spring Boot jar.
- Runtime stage: `eclipse-temurin:25-jre-alpine`, running as a non-root user.

Build one locally:

```bash
docker build -t driver-service:local ./driver-service
```

Inside a container, `localhost` no longer reaches the database - the DB is a
different container. That is why the datasource host must be the DB's network
name (e.g. `driver-db` under Compose, an RDS endpoint in the cloud), supplied
via `SPRING_DATASOURCE_URL`.

## 3. Whole-system Compose (Stage 6)

The root `docker-compose.yml` runs all four services + their databases together:

```bash
cp .env.example .env
docker compose up --build
```

Services wait for their database to be healthy (`depends_on: service_healthy`)
and expose an actuator-based healthcheck. driver-service reaches user-service at
`http://user-service:8081` - the service name is the local stand-in for
Kubernetes Service DNS.

## 4. Pushing images to ECR (Stage 10 groundwork)

`scripts/push-to-ecr.sh` builds, tags, and pushes every service image to Amazon
ECR. It is dry-run by default (prints commands, changes nothing) and only acts
with `--push`:

```bash
# Dry run - prints exactly what it would do:
AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-southeast-1 ./scripts/push-to-ecr.sh

# Real push (requires AWS CLI configured and the ECR repos to already exist):
AWS_ACCOUNT_ID=123456789012 AWS_REGION=ap-southeast-1 ./scripts/push-to-ecr.sh --push
```

The script does not create AWS resources. Create the per-service ECR
repositories first (Stage 10, console or CloudFormation).

## 5. Pointing a service at Amazon RDS (Stage 9 groundwork)

Because the datasource is fully externalized, moving a service from local
Postgres to RDS changes only environment variables - no code, no rebuild, the
same image:

```bash
SPRING_DATASOURCE_URL=jdbc:postgresql://ridenow-driver.abc123.ap-southeast-1.rds.amazonaws.com:5432/driver_service
SPRING_DATASOURCE_USERNAME=driver
SPRING_DATASOURCE_PASSWORD=<from AWS Secrets Manager, not committed>
```

In EKS these become a ConfigMap (URL/username) and a Secret or Secrets Manager
reference (password). The Secrets Manager substitution point is exactly
`SPRING_DATASOURCE_PASSWORD`: the value moves from `.env` (local) to a managed
secret (cloud); the application never changes.

Flyway runs the same `V1__init_schema.sql` against RDS that it runs locally
(same PostgreSQL engine), so the schema is created identically on first boot.
