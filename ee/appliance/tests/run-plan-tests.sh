#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

require_file() {
  [ -f "$1" ] || { echo "missing file: $1" >&2; exit 1; }
}

require_dir() {
  [ -d "$1" ] || { echo "missing directory: $1" >&2; exit 1; }
}

require_text() {
  local haystack="$1"
  local needle="$2"
  printf '%s\n' "$haystack" | grep -Fq -- "$needle" || {
    echo "expected output to contain: $needle" >&2
    exit 1
  }
}

require_dir "$ROOT/ee/appliance"
require_dir "$ROOT/ee/appliance/flux"
require_dir "$ROOT/ee/appliance/releases"
require_dir "$ROOT/ee/appliance/schematics"
require_dir "$ROOT/ee/appliance/scripts"
require_dir "$ROOT/ee/appliance/tests"

require_file "$ROOT/ee/appliance/README.md"
require_file "$ROOT/ee/appliance/schematics/metal-amd64.yaml"
require_file "$ROOT/ee/appliance/releases/schema.json"
require_file "$ROOT/ee/appliance/releases/channels/candidate.json"
require_file "$ROOT/ee/appliance/releases/channels/stable.json"
require_file "$ROOT/ee/appliance/scripts/build-images.sh"

bash "$ROOT/ee/appliance/scripts/build-images.sh" --help >/dev/null

dry_run_output="$(
  EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  bash "$ROOT/ee/appliance/scripts/build-images.sh" \
    --release-version 0.0.1 \
    --talos-version v1.12.0 \
    --kubernetes-version v1.31.4 \
    --app-version main \
    --dry-run
)"

require_text "$dry_run_output" "\"releaseVersion\": \"0.0.1\""
require_text "$dry_run_output" "\"schematicId\": \"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\""
require_text "$dry_run_output" "https://factory.talos.dev/image/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/v1.12.0/metal-amd64.iso"
require_text "$dry_run_output" "factory.talos.dev/metal-installer/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:v1.12.0"
require_text "$dry_run_output" "\"valuesProfile\": \"talos-single-node\""

jq -e '.title == "Alga Talos Appliance Release Manifest"' "$ROOT/ee/appliance/releases/schema.json" >/dev/null
jq -e '.channel == "candidate"' "$ROOT/ee/appliance/releases/channels/candidate.json" >/dev/null
jq -e '.channel == "stable"' "$ROOT/ee/appliance/releases/channels/stable.json" >/dev/null
yq eval '.customization' "$ROOT/ee/appliance/schematics/metal-amd64.yaml" >/dev/null

cat <<'EOF'
appliance image scaffolding checks passed
EOF
