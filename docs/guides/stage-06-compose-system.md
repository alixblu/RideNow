# Stage 6 - Run the whole local system with Compose

> Part: PART 2 - CONTAINERIZATION
> Status: OUTLINE. Local backend build/run steps (Docker). Ask to expand into full
> step-by-step detail when you reach it.

## Outline of steps

- [ ] Extend compose so app + database start together with one docker compose up.
- [ ] Add healthchecks and depends_on: condition: service_healthy so the app waits for the DB.
- [ ] Bring up driver-service + user-service + both databases together.
- [ ] Confirm the two-service Stage 4 flow works entirely inside Compose.

## Definition of Done

- [ ] docker compose up starts the local system; down stops it cleanly
- [ ] app containers wait for their databases to be healthy before starting

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
