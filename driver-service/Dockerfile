# syntax=docker/dockerfile:1

# ---- Build stage -------------------------------------------------------------
# Full JDK + the project's Maven wrapper build the Spring Boot fat jar. Nothing
# from this stage ships in the final image, so build tools never reach runtime.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /build

# Copy the wrapper and POM first so dependency resolution is cached in its own
# layer; source changes below won't bust that layer.
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw

# Build the jar. Tests run against a database, which isn't present during image
# build, so they're skipped here (CI runs them separately). The Maven repo is
# mounted as a BuildKit cache so dependencies are downloaded once and reused
# across rebuilds instead of being re-fetched every time.
COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B clean package -DskipTests

# ---- Runtime stage -----------------------------------------------------------
# Slim JRE only. Runs as a non-root user for a smaller blast radius.
FROM eclipse-temurin:25-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=build /build/target/*.jar app.jar

# driver-service's default port (env-overridable via SERVER_PORT).
EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
