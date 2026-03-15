#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG:-}"
TALOSCONFIG_PATH="${TALOSCONFIG:-}"
NODE_IP=""
SITE_ID="appliance-single-node"
OUTPUT_DIR="${PWD}"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
TEMP_DIR=""

usage() {
  cat <<'EOF'
Usage:
  collect-support-bundle.sh --kubeconfig <path> [options]

Options:
  --kubeconfig <path>        Kubeconfig path
  --talosconfig <path>       Talosconfig path
  --node-ip <ip>             Talos node IP for node-level collection
  --site-id <id>             Bundle identifier (default: appliance-single-node)
  --output-dir <path>        Directory for the .tar.gz bundle (default: current directory)
  --help                     Show this help
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}

capture_cmd() {
  local output_file="$1"
  shift

  {
    printf '$'
    for arg in "$@"; do
      printf ' %q' "$arg"
    done
    printf '\n'
    "$@"
  } >"$output_file" 2>&1 || true
}

kubectl_capture() {
  local output_file="$1"
  shift
  capture_cmd "$output_file" kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
}

talos_capture() {
  local output_file="$1"
  shift

  if [ -z "$TALOSCONFIG_PATH" ] || [ -z "$NODE_IP" ]; then
    return 0
  fi

  capture_cmd "$output_file" talosctl --talosconfig "$TALOSCONFIG_PATH" -n "$NODE_IP" -e "$NODE_IP" "$@"
}

collect_namespace_logs() {
  local namespace="$1"
  local pod_list
  local pod_name
  local container_list
  local container_name
  local safe_namespace

  safe_namespace="$(printf '%s' "$namespace" | tr '/' '_')"

  pod_list="$(kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"

  printf '%s\n' "$pod_list" | while IFS= read -r pod_name; do
    [ -n "$pod_name" ] || continue

    container_list="$(kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get pod "$pod_name" -o jsonpath='{range .spec.initContainers[*]}{.name}{"\n"}{end}{range .spec.containers[*]}{.name}{"\n"}{end}' 2>/dev/null || true)"
    printf '%s\n' "$container_list" | while IFS= read -r container_name; do
      [ -n "$container_name" ] || continue
      kubectl_capture "$TEMP_DIR/logs/${safe_namespace}-${pod_name}-${container_name}.log" -n "$namespace" logs "$pod_name" -c "$container_name" --tail=500
      kubectl_capture "$TEMP_DIR/logs/${safe_namespace}-${pod_name}-${container_name}-previous.log" -n "$namespace" logs "$pod_name" -c "$container_name" --previous --tail=500
    done
  done
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --talosconfig)
      TALOSCONFIG_PATH="$2"
      shift 2
      ;;
    --node-ip)
      NODE_IP="$2"
      shift 2
      ;;
    --site-id)
      SITE_ID="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
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

require_command kubectl
require_command tar
require_command date

if [ -z "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig path is required via --kubeconfig or KUBECONFIG." >&2
  exit 1
fi

if [ ! -f "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig file not found: $KUBECONFIG_PATH" >&2
  exit 1
fi

if [ -n "$TALOSCONFIG_PATH" ] && [ ! -f "$TALOSCONFIG_PATH" ]; then
  echo "Talosconfig file not found: $TALOSCONFIG_PATH" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alga-support-bundle.XXXXXX")"
trap cleanup EXIT

mkdir -p "$TEMP_DIR"/{cluster,logs,talos,meta}

cat >"$TEMP_DIR/meta/summary.txt" <<EOF
siteId: $SITE_ID
generatedAt: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
repoRoot: $REPO_ROOT
hasTalosContext: $( [ -n "$TALOSCONFIG_PATH" ] && [ -n "$NODE_IP" ] && printf yes || printf no )
EOF

kubectl_capture "$TEMP_DIR/cluster/version.txt" version
kubectl_capture "$TEMP_DIR/cluster/nodes.txt" get nodes -o wide
kubectl_capture "$TEMP_DIR/cluster/node-describe.txt" describe nodes
kubectl_capture "$TEMP_DIR/cluster/storage-classes.txt" get storageclass
kubectl_capture "$TEMP_DIR/cluster/persistent-volumes.txt" get pv
kubectl_capture "$TEMP_DIR/cluster/persistent-volume-claims.txt" get pvc -A
kubectl_capture "$TEMP_DIR/cluster/events.txt" get events -A --sort-by=.lastTimestamp
kubectl_capture "$TEMP_DIR/cluster/flux-sources.txt" -n flux-system get gitrepositories.source.toolkit.fluxcd.io -o yaml
kubectl_capture "$TEMP_DIR/cluster/flux-kustomizations.txt" -n flux-system get kustomizations.kustomize.toolkit.fluxcd.io -o yaml
kubectl_capture "$TEMP_DIR/cluster/flux-helm-releases.txt" -n alga-system get helmreleases.helm.toolkit.fluxcd.io -o yaml
kubectl_capture "$TEMP_DIR/cluster/alga-pods.txt" -n msp get pods -o wide
kubectl_capture "$TEMP_DIR/cluster/alga-jobs.txt" -n msp get jobs -o yaml
kubectl_capture "$TEMP_DIR/cluster/alga-configmaps.txt" -n alga-system get configmaps -o yaml
kubectl_capture "$TEMP_DIR/cluster/alga-secrets.txt" -n msp get secrets -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
kubectl_capture "$TEMP_DIR/cluster/describe-db.txt" -n msp describe statefulset db
kubectl_capture "$TEMP_DIR/cluster/describe-redis.txt" -n msp describe statefulset redis
kubectl_capture "$TEMP_DIR/cluster/describe-alga-core.txt" -n msp describe deployment alga-core-sebastian

collect_namespace_logs "flux-system"
collect_namespace_logs "alga-system"
collect_namespace_logs "msp"

talos_capture "$TEMP_DIR/talos/version.txt" version
talos_capture "$TEMP_DIR/talos/health.txt" health --wait-timeout 30s
talos_capture "$TEMP_DIR/talos/services.txt" service
talos_capture "$TEMP_DIR/talos/links.txt" get links
talos_capture "$TEMP_DIR/talos/addresses.txt" get addresses
talos_capture "$TEMP_DIR/talos/routes.txt" get routes
talos_capture "$TEMP_DIR/talos/hostname.txt" get hostname
talos_capture "$TEMP_DIR/talos/resolvers.txt" get resolvers

BUNDLE_PATH="$OUTPUT_DIR/${SITE_ID}-support-bundle-$(date -u +"%Y%m%dT%H%M%SZ").tar.gz"
mkdir -p "$OUTPUT_DIR"
tar -C "$TEMP_DIR" -czf "$BUNDLE_PATH" .

echo "Support bundle written to $BUNDLE_PATH"
