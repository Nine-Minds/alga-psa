#!/usr/bin/env bash
# Register this launcher as this card's review-app command. The board owns
# admission and the process; typechecking and production compilation run in order.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/server"
: "${PORT:=23374}"
export PORT
export DEV_ALLOWED_ORIGINS="${DEV_ALLOWED_ORIGINS:-feature-co-managed-it.localhost,127.0.0.1,localhost}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=12288}"

echo '[alga-card-service] phase=building'
revision="$(git -C "$REPO_ROOT" rev-parse HEAD)"
echo "Typechecking review candidate $revision"
"$REPO_ROOT/node_modules/.bin/tsc" --noEmit
if [[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" != "$revision" ]]; then
  echo 'Checkout revision changed during typecheck; restart the registered review-app.' >&2
  exit 1
fi
echo "Typecheck passed for $revision"
exec bash /home/robert/.alga-xo/scripts/review-app.sh
