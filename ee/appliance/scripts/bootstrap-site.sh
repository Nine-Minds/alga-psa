#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

exec "$REPO_ROOT/ee/appliance/scripts/bootstrap-appliance.sh" "$@"
