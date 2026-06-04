#!/usr/bin/env bash
#
# build-mem.sh — measure peak memory of `npm run build` in a clean container.
#
# Host `node` here is a snap, which relocates node processes into snap-managed
# cgroups and defeats host-side cgroup accounting. Running the build in a Docker
# container sidesteps that: the whole build lives in one cgroup whose
# `memory.peak` (cgroup v2) is the authoritative whole-tree high-water mark.
#
# The container reuses the worktree's existing node_modules as-is (node:24
# matches the host node major), so there's no install step.
#
# Usage:
#   scripts/build-mem.sh [--image node:24-bookworm] [--memory 8g] \
#                        [-- <harness flags...>]
#
# Examples:
#   scripts/build-mem.sh                       # full cold build, all host RAM
#   scripts/build-mem.sh --memory 8g           # fail/measure under an 8 GB cap
#   scripts/build-mem.sh -- --label before     # tag this run "before"
#   scripts/build-mem.sh -- --build-cmd "npm run build:ee" --label ee
#
# Everything after `--` (or any flag this script doesn't recognize) is passed
# straight to scripts/build-mem-harness.mjs. Harness flags:
#   --build-cmd <cmd>  --label <name>  --skip-clear  --interval-ms <n>  --json-only
set -euo pipefail

IMAGE="node:24-bookworm"
MEMORY=""
HARNESS_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image)  IMAGE="$2"; shift 2 ;;
    --memory) MEMORY="$2"; shift 2 ;;
    --)       shift; HARNESS_ARGS+=("$@"); break ;;
    *)        HARNESS_ARGS+=("$1"); shift ;;  # pass unknown flags to the harness
  esac
done

# Repo root = parent of this script's dir.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found on PATH" >&2
  exit 127
fi
if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  echo "error: $REPO_ROOT/node_modules missing — run npm install in the worktree first" >&2
  exit 1
fi

# Run as the host user so build artifacts (server/.next, caches, .build-mem) are
# owned by the caller, not root. HOME points at a writable dir on the mount so
# npm/nx caches don't try to write to a non-existent home for this uid.
DOCKER_ARGS=(run --rm --init -v "$REPO_ROOT":/work -w /work
  --user "$(id -u):$(id -g)" -e HOME=/tmp)
[[ -t 1 ]] && DOCKER_ARGS+=(-t)
[[ -n "$MEMORY" ]] && DOCKER_ARGS+=(--memory "$MEMORY" --memory-swap "$MEMORY")
DOCKER_ARGS+=("$IMAGE" node scripts/build-mem-harness.mjs)

echo "▶ build-mem: image=$IMAGE memory=${MEMORY:-unlimited} harness_args=[${HARNESS_ARGS[*]:-}]" >&2
exec docker "${DOCKER_ARGS[@]}" "${HARNESS_ARGS[@]}"
