# Stage 5 - Containerize one service

> Part: PART 2 - CONTAINERIZATION
> Status: OUTLINE. Ask to expand this into full click-by-click detail when you reach it,
> so the steps are verified against the current tooling/console at that time.

## Outline of steps

- [ ] Write a multi-stage Dockerfile for driver-service (build with Maven+JDK, run on a slim JRE).
- [ ] Build the image: docker build -t driver-service:local .
- [ ] Understand container networking: the app can no longer use localhost to reach its DB.
- [ ] Run the app container on the same Docker network as driver-db; use the container name as host.
- [ ] Re-run the Stage 1 create/read loop against the containerized app.

## Definition of Done

- [ ] driver-service runs as a container image
- [ ] the end-to-end loop still passes against the containerized service
- [ ] you can explain why 'localhost' stops working inside a container

When done, mark the matching stage `[x]` in `../LEARNING_PATH.md`.
