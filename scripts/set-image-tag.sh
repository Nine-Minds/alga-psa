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
REGISTRY="${ALGA_IMAGE_REPO:-ghcr.io/nine-minds/alga-psa-ce}"
IMAGE_PLATFORM="${ALGA_IMAGE_PLATFORM:-linux/amd64}"
NEXT_BUILD_MAX_OLD_SPACE_SIZE="${NEXT_BUILD_MAX_OLD_SPACE_SIZE:-12288}"

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

# Function to check if the image already exists locally
check_local_image_exists() {
  local tag="$1"
  docker image inspect "${REGISTRY}:${tag}" >/dev/null 2>&1
}

pull_image() {
  local tag="$1"
  echo -e "${BLUE}→${NC} Pulling ${REGISTRY}:${tag} for ${IMAGE_PLATFORM}..." >&2
  docker pull --platform "${IMAGE_PLATFORM}" "${REGISTRY}:${tag}"
}

build_local_image() {
  local tag="$1"
  echo -e "${BLUE}→${NC} Building ${REGISTRY}:${tag} from the current checkout..." >&2
  echo -e "${BLUE}→${NC} Build platform: ${IMAGE_PLATFORM}" >&2
  echo -e "${BLUE}→${NC} Next.js max old space: ${NEXT_BUILD_MAX_OLD_SPACE_SIZE} MB" >&2

  cd "${ROOT_DIR}"
  docker build \
    --platform "${IMAGE_PLATFORM}" \
    --build-arg "NEXT_BUILD_MAX_OLD_SPACE_SIZE=${NEXT_BUILD_MAX_OLD_SPACE_SIZE}" \
    -f Dockerfile.build \
    -t "${REGISTRY}:${tag}" \
    .
}

write_tag_file() {
  local tag="$1"
  cat >"${TAG_FILE}" <<EOF
ALGA_IMAGE_TAG=${tag}
EOF
  echo -e "${GREEN}✓${NC} Pinned ALGA_IMAGE_TAG=${tag} to ${TAG_FILE}" >&2
}

cd "${ROOT_DIR}"

# Explicit override remains available for CI/support scenarios, but it no longer
# falls back to an unrelated recent commit. If the user pins a tag, that exact tag
# must exist remotely or locally.
if [[ -n "${ALGA_IMAGE_TAG:-}" ]]; then
  tag="${ALGA_IMAGE_TAG}"
  echo -e "${BLUE}→${NC} Using ALGA_IMAGE_TAG from environment: ${tag}" >&2

  if check_tag_exists "${tag}"; then
    pull_image "${tag}"
    write_tag_file "${tag}"
    exit 0
  fi

  if check_local_image_exists "${tag}"; then
    echo -e "${GREEN}✓${NC} Using existing local image ${REGISTRY}:${tag}" >&2
    write_tag_file "${tag}"
    exit 0
  fi

  echo -e "${RED}✗${NC} Explicit ALGA_IMAGE_TAG '${tag}' was not found remotely or locally for ${REGISTRY}." >&2
  if [[ -n "${LAST_CHECK_ERROR}" ]]; then
    echo -e "${YELLOW}ℹ${NC}  docker manifest inspect failed with:" >&2
    while IFS= read -r line; do
      echo -e "      ${line}" >&2
    done <<<"${LAST_CHECK_ERROR}"
  fi
  echo -e "${YELLOW}ℹ${NC}  Unset ALGA_IMAGE_TAG to build from the current checkout, or set it to an existing image tag." >&2
  exit 1
fi

head_sha="$(git rev-parse --short=8 HEAD)"
worktree_status="$(git status --porcelain --untracked-files=normal)"

if [[ -n "${worktree_status}" ]]; then
  tag="${head_sha}-local"
  echo -e "${YELLOW}⚠${NC}  Worktree has uncommitted changes; building a local image instead of using the published HEAD image." >&2
  echo -e "${YELLOW}ℹ${NC}  Local image tag: ${tag}" >&2
  build_local_image "${tag}"
  write_tag_file "${tag}"
  exit 0
fi

tag="${head_sha}"
echo -e "${BLUE}→${NC} Using current checkout SHA: ${tag}" >&2

if check_tag_exists "${tag}"; then
  pull_image "${tag}"
  write_tag_file "${tag}"
  exit 0
fi

if [[ -n "${LAST_CHECK_ERROR}" ]]; then
  echo -e "${YELLOW}ℹ${NC}  No published image found for current checkout ${tag}:" >&2
  while IFS= read -r line; do
    echo -e "      ${line}" >&2
  done <<<"${LAST_CHECK_ERROR}"
fi

if check_local_image_exists "${tag}" && [[ "${ALGA_FORCE_LOCAL_BUILD:-false}" != "true" ]]; then
  echo -e "${GREEN}✓${NC} Using existing local image ${REGISTRY}:${tag}" >&2
  echo -e "${YELLOW}ℹ${NC}  Set ALGA_FORCE_LOCAL_BUILD=true to rebuild it." >&2
  write_tag_file "${tag}"
  exit 0
fi

build_local_image "${tag}"
write_tag_file "${tag}"
