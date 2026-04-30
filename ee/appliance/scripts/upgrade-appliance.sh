#!/usr/bin/env bash
set -euo pipefail

RELEASE_VERSION=""
KUBECONFIG_PATH="${KUBECONFIG:-}"
CONFIG_DIR=""
PROFILE=""
DRY_RUN=false
SKIP_RECONCILE=false
RECONCILE_TIMEOUT="45m"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
TEMP_DIR=""

usage() {
  cat <<'EOF'
Usage:
  upgrade-appliance.sh --release-version <version> --kubeconfig <path> [options]

Options:
  --release-version <version>  Appliance release version from ee/appliance/releases/
  --kubeconfig <path>          Target appliance kubeconfig
  --config-dir <path>          Optional directory to persist rendered values
  --profile <name>             Override values profile (defaults to manifest value)
  --skip-reconcile             Apply values without running flux reconcile helmrelease
  --reconcile-timeout <dur>    Flux reconcile timeout (default: 45m)
  --dry-run                    Print the planned commands without mutating cluster state
  --help                       Show this help
EOF
}

run_cmd() {
  if $DRY_RUN; then
    printf '+'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    return 0
  fi
  "$@"
}

release_field() {
  local jq_filter="$1"
  jq -r "$jq_filter" "$REPO_ROOT/ee/appliance/releases/$RELEASE_VERSION/release.json"
}

yaml_string() {
  python3 - "$1" <<'PY'
import json
import sys

print(json.dumps(sys.argv[1]))
PY
}

set_yaml_value() {
  local file_path="$1"
  local dotted_path="$2"
  local value="$3"

  python3 - "$file_path" "$dotted_path" "$value" <<'PY'
import sys
from pathlib import Path

file_path = Path(sys.argv[1])
target = sys.argv[2].split(".")
value = sys.argv[3]
lines = file_path.read_text().splitlines()
stack = []
replaced = False
output = []

for line in lines:
    stripped = line.lstrip()
    indent = len(line) - len(stripped)

    while stack and indent <= stack[-1][0]:
        stack.pop()

    if stripped.endswith(":") and not stripped.startswith("- "):
        stack.append((indent, stripped[:-1].strip()))
        output.append(line)
        continue

    current = [key for _, key in stack]
    if current == target[:-1] and stripped.startswith(f"{target[-1]}:"):
        output.append(f"{line[:indent]}{target[-1]}: {value}")
        replaced = True
    else:
        output.append(line)

if not replaced:
    raise SystemExit(f"Failed to update {'.'.join(target)} in {file_path}")

file_path.write_text("\n".join(output) + "\n")
PY
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-version)
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --config-dir)
      CONFIG_DIR="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --skip-reconcile)
      SKIP_RECONCILE=true
      shift
      ;;
    --reconcile-timeout)
      RECONCILE_TIMEOUT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
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

if [ -z "$RELEASE_VERSION" ] || [ -z "$KUBECONFIG_PATH" ]; then
  echo "release-version and kubeconfig are required" >&2
  usage >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/ee/appliance/releases/$RELEASE_VERSION/release.json" ]; then
  echo "Release manifest not found: $REPO_ROOT/ee/appliance/releases/$RELEASE_VERSION/release.json" >&2
  exit 1
fi

if [ -z "$PROFILE" ]; then
  PROFILE="$(release_field '.app.valuesProfile')"
fi

if [ -z "$CONFIG_DIR" ]; then
  CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alga-appliance-upgrade-values.XXXXXX")"
  TEMP_DIR="$CONFIG_DIR"
else
  mkdir -p "$CONFIG_DIR"
fi

mkdir -p "$CONFIG_DIR/values"

configmap_file_key() {
  local name="$1"
  printf '%s.%s.yaml' "$name" "$PROFILE"
}

for name in alga-core pgbouncer temporal workflow-worker email-service temporal-worker; do
  file_key="$(configmap_file_key "$name")"
  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n alga-system get configmap appliance-values-$name -o go-template='{{ index .data \"$file_key\" }}' > $CONFIG_DIR/values/$name.$PROFILE.yaml"
    cp "$REPO_ROOT/ee/appliance/flux/profiles/$PROFILE/values/$name.$PROFILE.yaml" "$CONFIG_DIR/values/$name.$PROFILE.yaml"
  else
    kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system get configmap "appliance-values-$name" -o "go-template={{ index .data \"$file_key\" }}" > "$CONFIG_DIR/values/$name.$PROFILE.yaml"
  fi
done

set_yaml_value "$CONFIG_DIR/values/alga-core.$PROFILE.yaml" "setup.image.tag" "$(yaml_string "$(release_field '.app.images.algaCore')")"
set_yaml_value "$CONFIG_DIR/values/alga-core.$PROFILE.yaml" "server.image.tag" "$(yaml_string "$(release_field '.app.images.algaCore')")"
set_yaml_value "$CONFIG_DIR/values/workflow-worker.$PROFILE.yaml" "image.tag" "$(yaml_string "$(release_field '.app.images.workflowWorker')")"
set_yaml_value "$CONFIG_DIR/values/email-service.$PROFILE.yaml" "image.tag" "$(yaml_string "$(release_field '.app.images.emailService')")"
set_yaml_value "$CONFIG_DIR/values/temporal-worker.$PROFILE.yaml" "image.tag" "$(yaml_string "$(release_field '.app.images.temporalWorker')")"

cat >"$CONFIG_DIR/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
generatorOptions:
  disableNameSuffixHash: true
configMapGenerator:
  - name: appliance-values-alga-core
    namespace: alga-system
    files:
      - alga-core.$PROFILE.yaml=values/alga-core.$PROFILE.yaml
  - name: appliance-values-pgbouncer
    namespace: alga-system
    files:
      - pgbouncer.$PROFILE.yaml=values/pgbouncer.$PROFILE.yaml
  - name: appliance-values-temporal
    namespace: alga-system
    files:
      - temporal.$PROFILE.yaml=values/temporal.$PROFILE.yaml
  - name: appliance-values-workflow-worker
    namespace: alga-system
    files:
      - workflow-worker.$PROFILE.yaml=values/workflow-worker.$PROFILE.yaml
  - name: appliance-values-email-service
    namespace: alga-system
    files:
      - email-service.$PROFILE.yaml=values/email-service.$PROFILE.yaml
  - name: appliance-values-temporal-worker
    namespace: alga-system
    files:
      - temporal-worker.$PROFILE.yaml=values/temporal-worker.$PROFILE.yaml
EOF

if $DRY_RUN; then
  echo "+ kubectl --kubeconfig $KUBECONFIG_PATH apply -k $CONFIG_DIR"
  echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n alga-system create configmap appliance-release-selection ..."
  if ! $SKIP_RECONCILE; then
    echo "+ flux --kubeconfig $KUBECONFIG_PATH reconcile helmrelease alga-core -n alga-system --with-source --timeout $RECONCILE_TIMEOUT"
    for release_name in pgbouncer temporal workflow-worker email-service temporal-worker; do
      echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n alga-system annotate helmrelease $release_name reconcile.fluxcd.io/requestedAt=<timestamp> --overwrite"
    done
  fi
  exit 0
fi

kubectl --kubeconfig "$KUBECONFIG_PATH" apply -k "$CONFIG_DIR"

kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system create configmap appliance-release-selection \
  --from-literal=releaseVersion="$RELEASE_VERSION" \
  --from-literal=appVersion="$(release_field '.app.version')" \
  --from-literal=releaseBranch="$(release_field '.app.releaseBranch')" \
  --from-literal=algaCoreTag="$(release_field '.app.images.algaCore')" \
  --from-literal=workflowWorkerTag="$(release_field '.app.images.workflowWorker')" \
  --from-literal=emailServiceTag="$(release_field '.app.images.emailService')" \
  --from-literal=temporalWorkerTag="$(release_field '.app.images.temporalWorker')" \
  --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -

if ! $SKIP_RECONCILE && command -v flux >/dev/null 2>&1; then
  flux --kubeconfig "$KUBECONFIG_PATH" reconcile helmrelease alga-core -n alga-system --with-source --timeout "$RECONCILE_TIMEOUT"

  requested_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for release_name in pgbouncer temporal workflow-worker email-service temporal-worker; do
    echo "► requesting HelmRelease reconcile for $release_name"
    if kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system get helmrelease "$release_name" >/dev/null 2>&1; then
      kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system annotate helmrelease "$release_name" \
        "reconcile.fluxcd.io/requestedAt=$requested_at" \
        --overwrite
    else
      echo "⚠ HelmRelease $release_name was not found; skipping reconcile request"
    fi
  done
fi

echo "Applied appliance release $RELEASE_VERSION"
