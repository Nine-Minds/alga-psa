#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG:-}"
RELEASE_NAME="alga-core"
RELEASE_NAMESPACE="alga-system"
WORKLOAD_NAMESPACE="msp"
CLEANUP_WORKLOADS=true
RECONCILE_TIMEOUT="45m"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage:
  repair-release.sh --kubeconfig <path> [options]

Options:
  --kubeconfig <path>           Target appliance kubeconfig
  --release-name <name>         HelmRelease name to repair (default: alga-core)
  --release-namespace <ns>      HelmRelease namespace (default: alga-system)
  --workload-namespace <ns>     Workload namespace (default: msp)
  --skip-cleanup-workloads      Skip deleting failed workload objects before reconcile
  --reconcile-timeout <dur>     Flux reconcile timeout (default: 45m)
  --dry-run                     Print the planned commands without mutating cluster state
  --help                        Show this help
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

while [ "$#" -gt 0 ]; do
  case "$1" in
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --release-name)
      RELEASE_NAME="$2"
      shift 2
      ;;
    --release-namespace)
      RELEASE_NAMESPACE="$2"
      shift 2
      ;;
    --workload-namespace)
      WORKLOAD_NAMESPACE="$2"
      shift 2
      ;;
    --skip-cleanup-workloads)
      CLEANUP_WORKLOADS=false
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

if [ -z "$KUBECONFIG_PATH" ]; then
  echo "kubeconfig is required" >&2
  usage >&2
  exit 1
fi

if $CLEANUP_WORKLOADS; then
  if $DRY_RUN; then
    echo "+ delete failed alga-core bootstrap jobs in namespace $WORKLOAD_NAMESPACE"
  else
    kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$WORKLOAD_NAMESPACE" get jobs -o name | \
      grep '^job.batch/alga-core-sebastian-bootstrap' | \
      xargs -r kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$WORKLOAD_NAMESPACE" delete --ignore-not-found
  fi

  run_cmd kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$WORKLOAD_NAMESPACE" delete pod \
    -l app.kubernetes.io/instance="$RELEASE_NAME",app.kubernetes.io/name=sebastian \
    --ignore-not-found
fi

if command -v flux >/dev/null 2>&1; then
  run_cmd flux --kubeconfig "$KUBECONFIG_PATH" reconcile helmrelease "$RELEASE_NAME" -n "$RELEASE_NAMESPACE" --with-source --timeout "$RECONCILE_TIMEOUT"
else
  echo "flux command not found" >&2
  exit 1
fi

echo "Submitted repair for $RELEASE_NAMESPACE/$RELEASE_NAME"
