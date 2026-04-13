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
require_file "$ROOT/ee/appliance/scripts/repair-release.sh"
require_file "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"
require_file "$ROOT/ee/appliance/scripts/upgrade-appliance.sh"

bash "$ROOT/ee/appliance/scripts/build-images.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/collect-support-bundle.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/install-storage.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/repair-release.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/reset-appliance-data.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/upgrade-appliance.sh" --help >/dev/null
bash -n "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh"
bash -n "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
bash -n "$ROOT/ee/appliance/scripts/install-storage.sh"
bash -n "$ROOT/ee/appliance/scripts/repair-release.sh"
bash -n "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"
bash -n "$ROOT/ee/appliance/scripts/upgrade-appliance.sh"

dry_run_output="$(
  EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  bash "$ROOT/ee/appliance/scripts/build-images.sh" \
    --release-version 1.0-rc5 \
    --talos-version v1.12.0 \
    --kubernetes-version v1.31.4 \
    --app-version 1.0-rc3 \
    --app-release-branch release/1.0-rc3 \
    --alga-core-tag aaa111 \
    --workflow-worker-tag bbb222 \
    --email-service-tag ccc333 \
    --temporal-worker-tag ddd444 \
    --dry-run
)"

require_text "$dry_run_output" "\"releaseVersion\": \"1.0-rc5\""
require_text "$dry_run_output" "\"schematicId\": \"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\""
require_text "$dry_run_output" "https://factory.talos.dev/image/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/v1.12.0/metal-amd64.iso"
require_text "$dry_run_output" "factory.talos.dev/metal-installer/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef:v1.12.0"
require_text "$dry_run_output" "\"valuesProfile\": \"talos-single-node\""
require_text "$dry_run_output" "\"releaseBranch\": \"release/1.0-rc3\""
require_text "$dry_run_output" "\"algaCore\": \"aaa111\""

bootstrap_tmp="$(mktemp -d)"
bootstrap_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode fresh \
    --node-ip 192.0.2.10 \
    --hostname alga-appliance \
    --app-url https://psa.example.test \
    --interface enp0s1 \
    --network-mode dhcp \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --config-dir "$bootstrap_tmp" \
    --dry-run
)"

require_text "$bootstrap_dry_run_output" "talosctl gen config"
require_text "$bootstrap_dry_run_output" "reset-appliance-data.sh"
require_text "$bootstrap_dry_run_output" "create source git alga-appliance"
require_text "$bootstrap_dry_run_output" "install-storage.sh --kubeconfig"
require_text "$bootstrap_dry_run_output" "collect-support-bundle.sh"
require_text "$bootstrap_dry_run_output" "Appliance claim URL (one-time): https://psa.example.test/auth/appliance-claim?token=<token>"
require_text "$bootstrap_dry_run_output" "appliance-claim-token"
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'appUrl: "https://psa.example.test"'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'host: "psa.example.test"'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'domainSuffix: ""'
require_text "$(cat "$bootstrap_tmp/values/alga-core.talos-single-node.yaml")" 'tag: 94446747'
require_text "$(cat "$bootstrap_tmp/values/workflow-worker.talos-single-node.yaml")" 'tag: 61e4a00e'

printf 'stale\n' > "$bootstrap_tmp/kubeconfig"
stale_bootstrap_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh" \
    --release-version 1.0-rc5 \
    --bootstrap-mode fresh \
    --node-ip 192.0.2.10 \
    --hostname alga-appliance \
    --app-url https://psa.example.test \
    --interface enp0s1 \
    --network-mode dhcp \
    --repo-url https://github.com/example/alga-psa.git \
    --repo-branch main \
    --config-dir "$bootstrap_tmp" \
    --dry-run
)"

require_text "$stale_bootstrap_dry_run_output" "talosctl gen config"
require_text "$stale_bootstrap_dry_run_output" "wait for Talos maintenance API on 192.0.2.10"

upgrade_tmp="$(mktemp -d)"
upgrade_dry_run_output="$(
  bash "$ROOT/ee/appliance/scripts/upgrade-appliance.sh" \
    --release-version 1.0-rc5 \
    --kubeconfig /tmp/example.kubeconfig \
    --config-dir "$upgrade_tmp" \
    --dry-run
)"

require_text "$upgrade_dry_run_output" "apply -k $upgrade_tmp"
require_text "$upgrade_dry_run_output" "appliance-release-selection"
require_text "$upgrade_dry_run_output" "reconcile helmrelease alga-core"

jq -e '.title == "Alga Talos Appliance Release Manifest"' "$ROOT/ee/appliance/releases/schema.json" >/dev/null
jq -e '.channel == "candidate"' "$ROOT/ee/appliance/releases/channels/candidate.json" >/dev/null
jq -e '.channel == "stable"' "$ROOT/ee/appliance/releases/channels/stable.json" >/dev/null
jq -e '.app.releaseBranch == "release/1.0-rc5"' "$ROOT/ee/appliance/releases/1.0-rc5/release.json" >/dev/null
jq -e '.app.images.algaCore == "94446747"' "$ROOT/ee/appliance/releases/1.0-rc5/release.json" >/dev/null
yq eval '.customization' "$ROOT/ee/appliance/schematics/metal-amd64.yaml" >/dev/null
kubectl apply --dry-run=client -f "$ROOT/ee/appliance/manifests/local-path-storage.yaml" >/dev/null

cat <<'EOF'
appliance image scaffolding checks passed
EOF
