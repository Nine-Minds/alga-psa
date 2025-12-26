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

LAST_CHECK_ERROR=""

# Ensure docker CLI is available before proceeding.
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}✗${NC} Docker CLI not found (command 'docker' is missing)." >&2
  echo -e "${YELLOW}ℹ${NC}  Install Docker Desktop or ensure 'docker' is on your PATH, then rerun this script." >&2
  exit 1
fi

# Function to check if a tag exists in the registry
check_tag_exists() {
  local tag="$1"
  echo -e "${BLUE}→${NC} Checking if tag '${tag}' exists in registry..." >&2

  # Use docker manifest inspect to check if the image exists
  if LAST_CHECK_ERROR="$(docker manifest inspect "${REGISTRY}:${tag}" 2>&1)"; then
    LAST_CHECK_ERROR=""
    return 0
  else
    return 1
  fi
}

# Function to find the latest release tag with a valid image
find_release_tag() {
  echo -e "${BLUE}→${NC} Searching for release tags..." >&2

  cd "${ROOT_DIR}"

  # Get release tags sorted by version (newest first)
  local release_tags=($(git tag -l 'release/*' --sort=-v:refname 2>/dev/null))

  if [[ ${#release_tags[@]} -eq 0 ]]; then
    echo -e "${YELLOW}⚠${NC}  No release tags found" >&2
    return 1
  fi

  # Check each release tag for a valid image (limit to first 5)
  local count=0
  for tag in "${release_tags[@]}"; do
    if [[ $count -ge 5 ]]; then
      break
    fi
    echo -e "${BLUE}→${NC} Trying release tag ${tag}..." >&2
    if check_tag_exists "${tag}"; then
      echo -e "${GREEN}✓${NC} Found valid release tag: ${tag}" >&2
      echo "${tag}"
      return 0
    fi
    ((count++))
  done

  return 1
}

# Function to find a valid tag from recent commits
find_valid_commit_tag() {
  echo -e "${YELLOW}⚠${NC}  No release tags available. Searching recent commits for a valid tag..." >&2

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
# Priority: ALGA_IMAGE_TAG env var > release tag > current commit SHA > recent commit fallback

tag=""

if [[ -n "${ALGA_IMAGE_TAG:-}" ]]; then
  tag="${ALGA_IMAGE_TAG}"
  echo -e "${BLUE}→${NC} Using ALGA_IMAGE_TAG from environment: ${tag}" >&2

  # Validate the explicitly set tag
  if ! check_tag_exists "${tag}"; then
    echo -e "${RED}✗${NC} Specified tag '${tag}' not found in registry: ${REGISTRY}" >&2
    if [[ -n "${LAST_CHECK_ERROR}" ]]; then
      echo -e "${YELLOW}ℹ${NC}  docker manifest inspect failed with:" >&2
      while IFS= read -r line; do
        echo -e "      ${line}" >&2
      done <<<"${LAST_CHECK_ERROR}"
    fi
    exit 1
  fi
  echo -e "${GREEN}✓${NC} Tag '${tag}' exists in registry" >&2
else
  cd "${ROOT_DIR}"

  # First, try to find a release tag with a valid image
  echo -e "${BLUE}→${NC} Looking for release tags with published images..." >&2
  if release_tag=$(find_release_tag); then
    tag="${release_tag}"
    echo -e "${GREEN}✓${NC} Using release tag: ${tag}" >&2
  else
    # Fall back to current commit SHA
    current_sha="$(git rev-parse --short=8 HEAD)"
    echo -e "${BLUE}→${NC} Trying current commit SHA: ${current_sha}" >&2

    if check_tag_exists "${current_sha}"; then
      tag="${current_sha}"
      echo -e "${GREEN}✓${NC} Using current commit SHA: ${tag}" >&2
    else
      echo -e "${YELLOW}⚠${NC}  Current commit SHA not found in registry" >&2

      # Last resort: search recent commits
      if valid_tag=$(find_valid_commit_tag); then
        tag="${valid_tag}"
        echo -e "${GREEN}✓${NC} Falling back to recent commit tag: ${tag}" >&2
      else
        echo -e "${RED}✗${NC} Could not find any valid image tags" >&2
        echo -e "${YELLOW}ℹ${NC}  Possible solutions:" >&2
        echo -e "   1. Wait for CI/CD to build and publish the image" >&2
        echo -e "   2. Build the image locally with: nu main.nu build-ai-web --local --push" >&2
        echo -e "   3. Checkout a commit with a published image" >&2
        echo -e "   4. Set ALGA_IMAGE_TAG environment variable to a known good tag" >&2
        exit 1
      fi
    fi
  fi
fi

cat >"${TAG_FILE}" <<EOF
ALGA_IMAGE_TAG=${tag}
EOF

echo -e "${GREEN}✓${NC} Pinned ALGA_IMAGE_TAG=${tag} to ${TAG_FILE}" >&2
