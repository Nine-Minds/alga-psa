#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") --base-iso <path> --release-version <version> [--dry-run]

Scaffold command for Ubuntu appliance ISO builds.

Required flags:
  --base-iso <path>         Path to Ubuntu Server 24.04 LTS ISO.
  --release-version <value> Appliance release version used in output naming.

Optional flags:
  --dry-run                 Validate arguments and directory layout only.
USAGE
}

BASE_ISO=""
RELEASE_VERSION=""
DRY_RUN=0

while (($#)); do
  case "$1" in
    --base-iso)
      BASE_ISO="${2:-}"
      shift 2
      ;;
    --release-version)
      RELEASE_VERSION="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BASE_ISO" || -z "$RELEASE_VERSION" ]]; then
  echo "--base-iso and --release-version are required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$BASE_ISO" ]]; then
  echo "Base ISO not found: $BASE_ISO" >&2
  exit 1
fi

for required_dir in \
  "$ROOT_DIR/config/nocloud" \
  "$ROOT_DIR/overlay" \
  "$ROOT_DIR/work" \
  "$ROOT_DIR/output"; do
  if [[ ! -d "$required_dir" ]]; then
    echo "Missing required directory: $required_dir" >&2
    exit 1
  fi
done

for required_file in \
  "$ROOT_DIR/config/nocloud/user-data" \
  "$ROOT_DIR/config/nocloud/meta-data"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required file: $required_file" >&2
    exit 1
  fi
done

OUTPUT_ISO="$ROOT_DIR/output/alga-appliance-ubuntu-${RELEASE_VERSION}.iso"
OUTPUT_SHA="$OUTPUT_ISO.sha256"

if [[ "$DRY_RUN" -eq 1 ]]; then
  cat <<DRY
[dry-run] Ubuntu appliance ISO layout validated.
[dry-run] base-iso: $BASE_ISO
[dry-run] release-version: $RELEASE_VERSION
[dry-run] output-iso: $OUTPUT_ISO
DRY
  exit 0
fi

cat <<MSG
Layout validation passed.
Full Ubuntu ISO remaster implementation is delivered in subsequent plan items.
Intended output target: $OUTPUT_ISO
MSG

: > "$OUTPUT_ISO"
sha256sum "$OUTPUT_ISO" > "$OUTPUT_SHA"

printf 'Created scaffold artifact and checksum:\n- %s\n- %s\n' "$OUTPUT_ISO" "$OUTPUT_SHA"
