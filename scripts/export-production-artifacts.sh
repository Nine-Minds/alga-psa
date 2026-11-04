#!/usr/bin/env bash
# Produce the production build artifacts (server/.next and the packages' dist
# directories) with Docker instead of a host Node toolchain, by exporting the
# `artifacts` stage of the edition's Dockerfile.build into this checkout. The
# runtime image is then built from the one runtime definition, Dockerfile or
# ee/server/Dockerfile, which packages those artifacts from the context.
#
#   scripts/export-production-artifacts.sh community|enterprise
#
# With a Node toolchain on the host, scripts/build-production-server.sh does
# the same work faster and keeps the webpack and Nx caches between builds.
set -euo pipefail

edition="${1:?usage: export-production-artifacts.sh community|enterprise}"
case "$edition" in
  community) dockerfile=Dockerfile.build ;;
  enterprise) dockerfile=ee/server/Dockerfile.build ;;
  *) echo "export-production-artifacts: unknown edition '$edition'" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# A stale chunk from an earlier build must not survive next to the new BUILD_ID.
rm -rf server/.next
docker buildx build \
  --platform "${ALGA_IMAGE_PLATFORM:-linux/amd64}" \
  --build-arg "NEXT_BUILD_MAX_OLD_SPACE_SIZE=${NEXT_BUILD_MAX_OLD_SPACE_SIZE:-12288}" \
  --target artifacts \
  --output "type=local,dest=." \
  --file "$dockerfile" \
  .
test -f server/.next/BUILD_ID
echo "exported server/.next/BUILD_ID $(cat server/.next/BUILD_ID) and the packages' dist directories for $edition"
