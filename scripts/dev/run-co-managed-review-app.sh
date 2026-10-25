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
DIST="${CO_MANAGED_REVIEW_DIST:-.next-review-candidate}"
STAMP="$REPO_ROOT/server/$DIST/.alga-review-revision"

revision() {
  local head diff
  head="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  diff="$(git -C "$REPO_ROOT" diff HEAD -- . ':(exclude)server/.next*' | sha1sum | cut -c1-12)"
  echo "$head+$diff"
}

echo '[alga-card-service] phase=building'
revision="$(git -C "$REPO_ROOT" rev-parse HEAD)"
echo "Typechecking review candidate $revision"
"$REPO_ROOT/node_modules/.bin/tsc" --noEmit
if [[ "$(git -C "$REPO_ROOT" rev-parse HEAD)" != "$revision" ]]; then
  echo 'Checkout revision changed during typecheck; restart the registered review-app.' >&2
  exit 1
fi
echo "Typecheck passed for $revision"

WANT="$(revision)"
if [[ ! -f "$REPO_ROOT/server/$DIST/BUILD_ID" || "$(cat "$STAMP" 2>/dev/null)" != "$WANT" ]]; then
  LOCK_DIR="$HOME/.alga-dev/locks"
  mkdir -p "$LOCK_DIR"
  exec 9>"$LOCK_DIR/next-build.lock"
  flock 9
  echo "Building $WANT into $DIST ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
  (cd "$REPO_ROOT" && npx nx build-deps server)
  NEXT_DIST_DIR="$DIST" NODE_OPTIONS="$NODE_OPTIONS" NODE_ENV=production npx next build --webpack
  printf '%s\n' "$WANT" > "$STAMP"
  flock -u 9
  exec 9>&-
else
  echo "Review build $WANT already exists in $DIST"
fi

REVIEW_ENV="$(PORT="$PORT" python3 - "$REPO_ROOT/server/.env.local" <<'PY'
import os, shlex, sys
from urllib.parse import urlsplit

values = {}
try:
    for line in open(sys.argv[1]):
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.rstrip('\n').split('=', 1)
            values[key.strip()] = value.strip()
except FileNotFoundError:
    sys.exit(0)
own = values.get('NEXTAUTH_URL', '')
parts = urlsplit(own)
if not parts.hostname or not parts.port:
    sys.exit(0)
review = f'{parts.scheme}://{parts.hostname}:{os.environ["PORT"]}'
for key, value in values.items():
    if value == own or value.startswith(own + '/'):
        print(f'export {key}={shlex.quote(review + value[len(own):])}')
PY
)"
eval "$REVIEW_ENV"
echo "Serving ${NEXTAUTH_URL:-the .env.local NEXTAUTH_URL} from $DIST"
echo '[alga-card-service] phase=serving'
NEXT_DIST_DIR="$DIST" NODE_ENV=production exec npx next start -p "$PORT" -H 0.0.0.0
