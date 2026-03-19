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
require_dir "$ROOT/ee/appliance/manifests"
require_dir "$ROOT/ee/appliance/releases"
require_dir "$ROOT/ee/appliance/schematics"
require_dir "$ROOT/ee/appliance/scripts"
require_dir "$ROOT/ee/appliance/tests"

require_file "$ROOT/ee/appliance/README.md"
require_file "$ROOT/ee/appliance/manifests/local-path-storage.yaml"
require_file "$ROOT/ee/appliance/schematics/metal-amd64.yaml"
require_file "$ROOT/ee/appliance/releases/schema.json"
require_file "$ROOT/ee/appliance/releases/channels/candidate.json"
require_file "$ROOT/ee/appliance/releases/channels/stable.json"
require_file "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh"
require_file "$ROOT/ee/appliance/scripts/build-images.sh"
require_file "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
require_file "$ROOT/ee/appliance/scripts/install-storage.sh"
require_file "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"

bash "$ROOT/ee/appliance/scripts/build-images.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/collect-support-bundle.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/install-storage.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/reset-appliance-data.sh" --help >/dev/null
bash -n "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh"
bash -n "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
bash -n "$ROOT/ee/appliance/scripts/install-storage.sh"
bash -n "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"

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

bootstrap_tmp="$(mktemp -d)"
bootstrap_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 0.0.1 \
    --bootstrap-mode fresh \
    --node-ip 192.0.2.10 \
    --hostname alga-appliance \
    --interface enp0s1 \
    --network-mode dhcp \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --config-dir "$bootstrap_tmp" \
    --alga-core-tag aaa111 \
    --workflow-worker-tag bbb222 \
    --email-service-tag ccc333 \
    --temporal-worker-tag ddd444 \
    --dry-run
)"

require_text "$bootstrap_dry_run_output" "talosctl gen config"
require_text "$bootstrap_dry_run_output" "reset-appliance-data.sh"
require_text "$bootstrap_dry_run_output" "create source git alga-appliance"
require_text "$bootstrap_dry_run_output" "install-storage.sh --kubeconfig"
require_text "$bootstrap_dry_run_output" "collect-support-bundle.sh"

jq -e '.title == "Alga Talos Appliance Release Manifest"' "$ROOT/ee/appliance/releases/schema.json" >/dev/null
jq -e '.channel == "candidate"' "$ROOT/ee/appliance/releases/channels/candidate.json" >/dev/null
jq -e '.channel == "stable"' "$ROOT/ee/appliance/releases/channels/stable.json" >/dev/null
yq eval '.customization' "$ROOT/ee/appliance/schematics/metal-amd64.yaml" >/dev/null
kubectl apply --dry-run=client -f "$ROOT/ee/appliance/manifests/local-path-storage.yaml" >/dev/null

cat <<'EOF'
appliance image scaffolding checks passed
EOF
