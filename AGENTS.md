# ChatGPT project context

This directory is a local mirror of the ChatGPT project “Cloud-native Microservices”.

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.


## Project instructions

# RideNow backend instructions

## Scope and working style

- RideNow is a Spring Boot microservices monorepo. A microservice is one small, self-contained, independently deployable Spring Boot application; it is not merely a class in a shared application.
- Work incrementally. Before modifying code, inspect the repository and make a short plan that identifies the affected service, its API/data ownership, and the smallest useful change.
- Keep changes small and scoped to the request. Do not perform broad refactors, rename unrelated code, or add speculative abstractions.
- After each implementation change, run that service's appropriate build and tests (or explain precisely why they cannot run).
- Inspect the existing Spring Initializr-generated configuration before changing a service. Preserve its Java version, Spring Boot version, build tool/wrapper, package naming, and dependency conventions unless the task explicitly requires a change.
- Prefer clear conventional Spring Boot code over architecture fashions. Do not introduce Clean Architecture, Hexagonal Architecture, DDD layers/aggregates, or elaborate framework wrappers unless requested.

## Monorepo layout and services

Keep one independently runnable Spring Boot application per microservice, normally with its own build file, wrapper/configuration, `src/`, and `@SpringBootApplication` entry point:

```text
ridenow/
  user-service/
  driver-service/
  trip-service/
  matching-service/
  payment-service/
  notification-worker/
```

Intended responsibilities:

- `user-service`: rider/user accounts and user-owned profile data.
- `driver-service`: driver accounts, profiles, and driver-owned operational data.
- `trip-service`: trip lifecycle and trip-owned data.
- `matching-service`: driver-trip matching decisions and matching-owned state.
- `payment-service`: payment processing records and payment-owned state.
- `notification-worker`: asynchronous notification delivery and its delivery state; it may not need an HTTP API.
- Ratings ownership is intentionally undecided. Do not create a ratings service or assign ratings tables to another service without an explicit decision.

## Application structure

Within each Spring Boot application, use a conventional layered structure beneath the root package containing the application class:

```text
src/main/java/<root-package>/
  controller/    # HTTP boundary
  dto/           # request/response payloads
  service/       # application/business logic
  repository/    # persistence access
  entity/        # JPA entities owned by this service
  exception/     # domain/application exceptions and error handling
  config/        # only when configuration is needed
```

- Controllers should be thin: validate input, invoke a service, and return DTOs/statuses. They must not expose entities directly.
- Put business rules and transaction boundaries in services. Repositories should remain focused on persistence queries.
- Use request and response DTOs at API boundaries; map explicitly or with a simple, established mapper. Do not add a mapping framework just for a few mappings.
- Use constructor injection. Do not use field injection.
- Use Lombok only where it improves clarity: e.g. `@Getter`, `@NoArgsConstructor(access = PROTECTED)` for JPA entities when needed, and `@RequiredArgsConstructor` for injected dependencies. Avoid indiscriminate `@Data` on entities or DTOs.
- Validate request DTOs with Jakarta Bean Validation annotations and use `@Valid` at controller boundaries.
- Define meaningful exceptions and handle them consistently with a focused `@RestControllerAdvice`; do not leak stack traces, persistence internals, or generic `500` responses for expected client errors.

## Data and service boundaries

- DBML is the source of truth for persistent fields. Locate and inspect the relevant DBML before creating or changing entities, columns, constraints, or indexes. Keep persistence models aligned with it; propose a DBML update before making a schema change that is not represented there.
- Each service owns its own data. Other services access it only through an explicit service API or future event contract, never by reading its tables directly.
- Do not create JPA entity relationships, foreign keys, joins, cascading operations, or repositories that span microservices. Store another service's identifier as a scalar value when needed.
- Do not share a cross-service entity/model module. If contracts are later shared, keep them intentional and narrowly scoped.

## Testing and delivery discipline

- Add or update focused tests with behavior changes. Prefer unit tests for service rules and web-slice/integration tests where they validate a real boundary or persistence behavior.
- Keep test setup local and deterministic. Avoid introducing external services just to test an early feature.
- Make an implementation usable end-to-end at its current boundary before moving to the next feature; do not scaffold empty layers for every future service.

## Deferred platform capabilities

Redis, SQS, EventBridge, WebSockets, Saga orchestration, Kubernetes, and AWS infrastructure are later RideNow goals, not prerequisites for the first service features. Do not add, configure, provision, or simulate them unless the user explicitly requests that capability. When requested later, introduce the smallest design that fits the established service and data boundaries.
