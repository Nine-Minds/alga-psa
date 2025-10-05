#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG_FILE="${ROOT_DIR}/.env.image"

# Determine the image tag to use.
# Priority: existing ALGA_IMAGE_TAG env var > short SHA > release tag fallback

if [[ -n "${ALGA_IMAGE_TAG:-}" ]]; then
  tag="${ALGA_IMAGE_TAG}"
else
  cd "${ROOT_DIR}"
  if git describe --exact-match --tags >/tmp/git_tag 2>/dev/null; then
    tag="$(cat /tmp/git_tag)"
  else
    tag="$(git rev-parse --short HEAD)"
  fi
fi

cat >"${TAG_FILE}" <<EOF
ALGA_IMAGE_TAG=${tag}
EOF

echo "Pinned ALGA_IMAGE_TAG=${tag} to ${TAG_FILE}" >&2
