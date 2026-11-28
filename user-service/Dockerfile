# syntax=docker/dockerfile:1
# OpenTelemetry Java agent: pinned release and SHA-256 (override with --build-arg).
ARG OTEL_AGENT_VERSION=2.34.0
ARG OTEL_AGENT_SHA256=da44154cea128257779c8a782b9651fd7c0c6aa177cd3810f9a867ac8509555d

# ---- Build stage -------------------------------------------------------------
FROM eclipse-temurin:25-jdk AS build
WORKDIR /build

COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN chmod +x mvnw

COPY src/ src/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B clean package -DskipTests

# ---- OTel agent stage --------------------------------------------------------
# Downloads the pinned agent jar and fails the build if the SHA-256 differs.
# The agent is only attached when JAVA_TOOL_OPTIONS is set (Kubernetes manifests).
FROM alpine:3.21 AS otel
ARG OTEL_AGENT_VERSION
ARG OTEL_AGENT_SHA256
RUN wget -q -O /opentelemetry-javaagent.jar \
      https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar \
 && echo "${OTEL_AGENT_SHA256}  /opentelemetry-javaagent.jar" | sha256sum -c -
# ---- Runtime stage -----------------------------------------------------------
FROM eclipse-temurin:25-jre-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=build /build/target/*.jar app.jar
COPY --from=otel /opentelemetry-javaagent.jar /opt/otel/opentelemetry-javaagent.jar

# user-service's default port (env-overridable via SERVER_PORT).
EXPOSE 8081

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
