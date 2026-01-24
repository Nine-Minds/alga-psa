#!/bin/sh
set -euo pipefail

# Keep this shim for backward compatibility; the real dev entrypoint lives at `server/dev-entrypoint.sh`.
exec /bin/sh /app/server/dev-entrypoint.sh
