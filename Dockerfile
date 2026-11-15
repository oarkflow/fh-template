# syntax=docker/dockerfile:1
# Multi-stage, reproducible build -> tiny non-root image with a read-only rootfs.

# --- 1. frontend bundle (needs web/frontend; skipped output is web/public) ---
FROM node:26-bookworm-slim AS frontend
WORKDIR /src/web/frontend
COPY web/frontend/package.json web/frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web/frontend/ ./
RUN npm run build

# --- 2. server binary (pure Go: modernc SQLite, no CGO) ---
FROM golang:1.27-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-trimpath
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN go build -ldflags="-s -w" -o /out/server ./cmd/server

# --- 3. runtime: distroless, non-root, no shell ---
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=frontend /src/web/public /app/web/public
COPY web/templates /app/web/templates
COPY web/wasm /app/web/wasm
COPY security /app/security
COPY policy.authz /app/policy.authz
# Writable state lives only on this volume (SQLite, sessions, backups).
COPY --from=build --chown=65532:65532 /tmp /app/data
VOLUME ["/app/data"]
USER 65532:65532
ENV APP_ENV=production APP_ADDR=0.0.0.0:8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 CMD ["/app/server", "-healthcheck"]
ENTRYPOINT ["/app/server"]
