#!/usr/bin/env bash
# Build the production Next.js application for one edition, outside Docker,
# exactly the way the builder stages of Dockerfile.build and
# ee/server/Dockerfile.build do it: assemblyscript templates, every upstream
# package through Nx, then `next build --webpack` with the edition's module
# resolution. Running it on the host lets the webpack filesystem cache
# (server/node_modules/.cache/webpack, see next.config.mjs) and the Nx cache
# survive between builds; inside the image they start empty every time.
#
#   scripts/build-production-server.sh community|enterprise
#
# Expects `npm install` to have run at the repository root. Produces
# server/.next plus the packages' dist directories, which the production
# Dockerfiles (Dockerfile, ee/server/Dockerfile) package from the context.
# The application version baked into the bundle comes from
# packages/core/package.json through next.config.mjs, the same file the Argo
# build reads for its NEXT_PUBLIC_APP_VERSION, so both pipelines agree without
# passing it; set NEXT_PUBLIC_APP_VERSION to override.
set -euo pipefail

edition="${1:?usage: build-production-server.sh community|enterprise}"
case "$edition" in
  community) export EDITION=ce NEXT_PUBLIC_EDITION=community ;;
  enterprise) export EDITION=ee NEXT_PUBLIC_EDITION=enterprise ;;
  *) echo "build-production-server: unknown edition '$edition'" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Build-only fallback secrets let NextAuth edge guards pass; real secrets are
# injected at runtime. Same values and heap as the Dockerfiles.
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET_BUILD:-dev-placeholder-nextauth-secret-32}"
export AUTH_SECRET="$NEXTAUTH_SECRET"
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=${NEXT_BUILD_MAX_OLD_SPACE_SIZE:-12288}"
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_FORCE_FEATURE_FLAGS="${NEXT_PUBLIC_FORCE_FEATURE_FLAGS:-}"
# A restored .nx/cache was written by another machine, which Nx otherwise
# refuses to read ("Unrecognized Cache Artifacts"); its entries are still
# content-addressed, so accept them.
export NX_REJECT_UNKNOWN_LOCAL_CACHE=0
# Next folds the server-action encryption key into the webpack cache version
# and generates a fresh key per build unless NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
# is set, so a restored webpack cache is only ever reused when the caller
# provides a stable key (CI uses a fixed test-only key for its candidates; a
# deployment build should use a secret of its own).
if [ -z "${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY:-}" ]; then
  echo "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is unset: the webpack cache cannot carry over to the next build"
fi

phase_started=$SECONDS
phase() { # <name> — report the previous phase's duration and start the next
  if [ -n "${phase_name:-}" ]; then echo "== $phase_name finished in $((SECONDS - phase_started))s"; fi
  phase_name="$1"; phase_started=$SECONDS
  echo "== $phase_name"
}

phase "assemblyscript invoice templates"
npm run build:assemblyscript

phase "upstream packages (nx build-deps server)"
npx nx build-deps server
# ee/server/Dockerfile refuses to package without the runtime exports that the
# appliance onboarding seeds import (@alga-psa/db, which imports @alga-psa/core).
if [ ! -f packages/db/dist/index.js ]; then (cd packages/db && npm run build); fi
test -f packages/core/dist/index.js
test -f packages/db/dist/index.js
export USE_PREBUILT=true

phase "next build --webpack ($edition)"
if [ -d server/node_modules/.cache/webpack ]; then
  echo "webpack filesystem cache present: $(du -sh server/node_modules/.cache/webpack | cut -f1)"
else
  echo "webpack filesystem cache absent: cold build"
fi
(cd server && npm exec -- next build --webpack)
phase "done"
test -f server/.next/BUILD_ID
echo "built server/.next/BUILD_ID $(cat server/.next/BUILD_ID) for $edition"
