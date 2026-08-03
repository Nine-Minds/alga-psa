#!/usr/bin/env bash

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PROJECT_NAME="alga-ce-persistence-smoke-${USER:-user}-$$"
readonly DB_SENTINEL="ce-db-$PPID-$$"
readonly FILE_SENTINEL="ce-file-$PPID-$$"
readonly FILE_PATH="/data/files/ce-compose-persistence-smoke.txt"
readonly POSTGRES_VOLUME="${PROJECT_NAME}_postgres_data"
readonly FILES_VOLUME="${PROJECT_NAME}_files_data"

COMPOSE_FILES=(
  -f docker-compose.yaml
  -f docker-compose.base.yaml
  -f docker-compose.ce.yaml
)
SMOKE_COMPOSE_FILES=(
  "${COMPOSE_FILES[@]}"
  -f scripts/tests/docker-compose.ce-persistence-smoke.yaml
)

compose() {
  APP_NAME="$PROJECT_NAME" docker compose -p "$PROJECT_NAME" "${COMPOSE_FILES[@]}" "$@"
}

smoke_compose() {
  APP_NAME="$PROJECT_NAME" docker compose -p "$PROJECT_NAME" "${SMOKE_COMPOSE_FILES[@]}" "$@"
}

cleanup() {
  smoke_compose down -v --rmi local --remove-orphans >/dev/null 2>&1 || true
}

wait_for_postgres() {
  local attempt

  for attempt in $(seq 1 30); do
    if smoke_compose exec -T postgres pg_isready -U postgres -d server >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "PostgreSQL did not become ready" >&2
  smoke_compose logs postgres >&2
  return 1
}

assert_prerequisites() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required to validate the resolved Compose configuration" >&2
    return 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "A reachable Docker daemon is required for the CE persistence smoke test" >&2
    echo "If Docker group membership was added after login, start a fresh shell or run: sg docker -c './scripts/smoke-test-ce-compose-persistence.sh'" >&2
    return 1
  fi
}

assert_canonical_config() {
  compose config --format json 2>/dev/null | node -e '
    const fs = require("node:fs");
    const config = JSON.parse(fs.readFileSync(0, "utf8"));
    const server = config.services?.server;
    const postgres = config.services?.postgres;

    const hasMount = (service, source, target) =>
      service?.volumes?.some((volume) => volume.source === source && volume.target === target);

    if (server?.build?.dockerfile !== "Dockerfile.dev") {
      throw new Error(`Expected CE server to build Dockerfile.dev, got ${server?.build?.dockerfile}`);
    }
    if (!hasMount(server, "files_data", "/data/files")) {
      throw new Error("CE server is missing files_data:/data/files");
    }
    if (!hasMount(postgres, "postgres_data", "/var/lib/postgresql/data")) {
      throw new Error("CE postgres is missing postgres_data:/var/lib/postgresql/data");
    }
  '
}

write_sentinels() {
  smoke_compose exec -T postgres sh -c \
    "PGPASSWORD=\"\$(cat /run/secrets/postgres_password)\" psql -U postgres -d server -v ON_ERROR_STOP=1 -c \"CREATE TABLE IF NOT EXISTS ce_compose_persistence_smoke (value text NOT NULL); TRUNCATE ce_compose_persistence_smoke; INSERT INTO ce_compose_persistence_smoke VALUES ('$DB_SENTINEL');\"" \
    >/dev/null
  smoke_compose exec -T server sh -c \
    "mkdir -p /data/files && printf '%s' '$FILE_SENTINEL' > '$FILE_PATH'"
}

assert_sentinels() {
  local actual_db_sentinel
  local actual_file_sentinel

  actual_db_sentinel="$(smoke_compose exec -T postgres sh -c \
    "PGPASSWORD=\"\$(cat /run/secrets/postgres_password)\" psql -U postgres -d server -Atqc 'SELECT value FROM ce_compose_persistence_smoke LIMIT 1'")"
  actual_file_sentinel="$(smoke_compose exec -T server sh -c "cat '$FILE_PATH'")"

  if [[ "$actual_db_sentinel" != "$DB_SENTINEL" ]]; then
    echo "Database sentinel did not survive compose down/up" >&2
    return 1
  fi
  if [[ "$actual_file_sentinel" != "$FILE_SENTINEL" ]]; then
    echo "File sentinel did not survive compose down/up" >&2
    return 1
  fi
}

main() {
  cd "$REPO_ROOT"
  assert_prerequisites
  trap cleanup EXIT

  echo "Validating canonical CE compose mounts and Dockerfile target"
  assert_canonical_config

  echo "Building the CE server from Dockerfile.dev"
  smoke_compose build server

  echo "Starting isolated source-build CE persistence services"
  smoke_compose up -d postgres
  wait_for_postgres
  smoke_compose up -d --no-deps server
  write_sentinels

  echo "Running ordinary compose down/up lifecycle"
  smoke_compose down --remove-orphans
  docker volume inspect "$POSTGRES_VOLUME" "$FILES_VOLUME" >/dev/null
  smoke_compose up -d postgres
  wait_for_postgres
  smoke_compose up -d --no-deps server
  assert_sentinels

  echo "Database and file sentinels survived compose down/up"

  echo "Confirming explicit down -v removes the isolated volumes"
  smoke_compose down -v --rmi local --remove-orphans
  if docker volume inspect "$POSTGRES_VOLUME" "$FILES_VOLUME" >/dev/null 2>&1; then
    echo "Expected down -v to remove the isolated persistence volumes" >&2
    return 1
  fi

  trap - EXIT
  echo "CE compose persistence smoke test passed"
}

main "$@"
