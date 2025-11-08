#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.runner-dev.yml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "docker-compose.runner-dev.yml not found in ${PROJECT_ROOT}" >&2
  exit 1
fi

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

docker compose -f "${COMPOSE_FILE}" "$@"
