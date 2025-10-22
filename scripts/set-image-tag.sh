#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG_FILE="${ROOT_DIR}/.env.image"

# Color codes for better UX
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Registry configuration
REGISTRY="ghcr.io/nine-minds/alga-psa-ce"
MAX_FALLBACK_ATTEMPTS=10

# Function to check if a tag exists in the registry
check_tag_exists() {
  local tag="$1"
  echo -e "${BLUE}→${NC} Checking if tag '${tag}' exists in registry..." >&2

  # Use docker manifest inspect to check if the image exists
  if docker manifest inspect "${REGISTRY}:${tag}" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

# Function to find a valid tag from recent commits
find_valid_tag() {
  echo -e "${YELLOW}⚠${NC}  Tag not found in registry. Searching recent commits for a valid tag..." >&2

  cd "${ROOT_DIR}"
  local commits=($(git rev-list HEAD -n ${MAX_FALLBACK_ATTEMPTS} --abbrev-commit --abbrev=8))

  for commit in "${commits[@]}"; do
    echo -e "${BLUE}→${NC} Trying commit ${commit}..." >&2
    if check_tag_exists "${commit}"; then
      echo -e "${GREEN}✓${NC} Found valid tag: ${commit}" >&2
      echo "${commit}"
      return 0
    fi
  done

  return 1
}

# Determine the image tag to use.
# Priority: existing ALGA_IMAGE_TAG env var > short SHA > release tag fallback

if [[ -n "${ALGA_IMAGE_TAG:-}" ]]; then
  tag="${ALGA_IMAGE_TAG}"
  echo -e "${BLUE}→${NC} Using ALGA_IMAGE_TAG from environment: ${tag}" >&2
else
  cd "${ROOT_DIR}"
  if git describe --exact-match --tags >/tmp/git_tag 2>/dev/null; then
    tag="$(cat /tmp/git_tag)"
    echo -e "${BLUE}→${NC} Using release tag: ${tag}" >&2
  else
    tag="$(git rev-parse --short=8 HEAD)"
    echo -e "${BLUE}→${NC} Using short commit SHA: ${tag}" >&2
  fi
fi

# Validate that the tag exists in the registry
if ! check_tag_exists "${tag}"; then
  echo -e "${RED}✗${NC} Tag '${tag}' not found in registry: ${REGISTRY}" >&2

  if valid_tag=$(find_valid_tag); then
    tag="${valid_tag}"
    echo -e "${GREEN}✓${NC} Falling back to valid tag: ${tag}" >&2
  else
    echo -e "${RED}✗${NC} Could not find any valid tags in the last ${MAX_FALLBACK_ATTEMPTS} commits" >&2
    echo -e "${YELLOW}ℹ${NC}  Possible solutions:" >&2
    echo -e "   1. Wait for CI/CD to build and publish the image" >&2
    echo -e "   2. Build the image locally with: nu main.nu build-ai-web --local --push" >&2
    echo -e "   3. Checkout a commit with a published image" >&2
    echo -e "   4. Set ALGA_IMAGE_TAG environment variable to a known good tag" >&2
    exit 1
  fi
else
  echo -e "${GREEN}✓${NC} Tag '${tag}' exists in registry" >&2
fi

cat >"${TAG_FILE}" <<EOF
ALGA_IMAGE_TAG=${tag}
EOF

echo -e "${GREEN}✓${NC} Pinned ALGA_IMAGE_TAG=${tag} to ${TAG_FILE}" >&2
