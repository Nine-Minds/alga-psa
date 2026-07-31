#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

require_file() {
  [ -f "$1" ] || { echo "missing file: $1" >&2; exit 1; }
}

require_dir() {
  [ -d "$1" ] || { echo "missing directory: $1" >&2; exit 1; }
}

forbid_path() {
  [ ! -e "$1" ] || { echo "obsolete appliance release path should not exist: $1" >&2; exit 1; }
}

require_text_file() {
  local file="$1"
  local needle="$2"
  grep -Fq -- "$needle" "$file" || {
    echo "expected $file to contain: $needle" >&2
    exit 1
  }
}

require_dir "$ROOT/ee/appliance"
require_dir "$ROOT/ee/appliance/flux"
require_dir "$ROOT/ee/appliance/manifests"
require_dir "$ROOT/ee/appliance/scripts"
require_dir "$ROOT/ee/appliance/tests"

require_file "$ROOT/ee/appliance/README.md"
require_file "$ROOT/ee/appliance/manifests/local-path-storage.yaml"
require_file "$ROOT/ee/appliance/flux/base/platform/appliance-status.yaml"
require_file "$ROOT/ee/appliance/flux/base/flux/kustomizations.yaml"
require_file "$ROOT/ee/appliance/flux/base/platform/kustomization.yaml"
require_file "$ROOT/ee/appliance/flux/base/core/kustomization.yaml"
require_file "$ROOT/ee/appliance/flux/base/background/kustomization.yaml"
require_file "$ROOT/ee/appliance/host-service/setup-engine.mjs"
require_file "$ROOT/ee/appliance/host-service/update-engine.mjs"
require_file "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
require_file "$ROOT/ee/appliance/scripts/install-storage.sh"
require_file "$ROOT/ee/appliance/scripts/repair-release.sh"
require_file "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"
require_file "$ROOT/ee/appliance/tests/local-utm-smoke.sh"

forbid_path "$ROOT/ee/appliance/releases"
forbid_path "$ROOT/ee/appliance/scripts/bootstrap-appliance.sh"
forbid_path "$ROOT/ee/appliance/scripts/bootstrap-site.sh"
forbid_path "$ROOT/ee/appliance/scripts/upgrade-appliance.sh"
forbid_path "$ROOT/ee/appliance/scripts/build-images.sh"
forbid_path "$ROOT/ee/appliance/scripts/build-release-manifest.py"
forbid_path "$ROOT/ee/appliance/scripts/publish-appliance-release.sh"

bash "$ROOT/ee/appliance/scripts/collect-support-bundle.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/install-storage.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/repair-release.sh" --help >/dev/null
bash "$ROOT/ee/appliance/scripts/reset-appliance-data.sh" --help >/dev/null
bash "$ROOT/ee/appliance/tests/local-utm-smoke.sh" --help >/dev/null
bash -n "$ROOT/ee/appliance/scripts/collect-support-bundle.sh"
bash -n "$ROOT/ee/appliance/scripts/install-storage.sh"
bash -n "$ROOT/ee/appliance/scripts/repair-release.sh"
bash -n "$ROOT/ee/appliance/scripts/reset-appliance-data.sh"
bash -n "$ROOT/ee/appliance/tests/local-utm-smoke.sh"
bash "$ROOT/ee/appliance/scripts/reset-appliance-data.sh" --kubeconfig /tmp/example.kubeconfig --force --dry-run >/dev/null

require_text_file "$ROOT/ee/appliance/host-service/setup-engine.mjs" "DEFAULT_RELEASE_REPOSITORY"
require_text_file "$ROOT/ee/appliance/host-service/setup-engine.mjs" "resolveReleaseManifest"
require_text_file "$ROOT/ee/appliance/host-service/update-engine.mjs" "runAppChannelUpdate"
require_text_file "$ROOT/ee/appliance/flux/base/platform/appliance-status.yaml" "nine-minds/alga-appliance-release"
require_text_file "$ROOT/ee/appliance/README.md" "nm-kube-config/alga-psa/workflows/composite/alga-psa-build-migrate-deploy.yaml"
require_text_file "$ROOT/ee/docs/appliance/architecture.md" "publish-appliance-release=true"

echo "appliance plan tests passed"
