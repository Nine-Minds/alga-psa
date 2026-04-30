#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG:-}"
APP_NAMESPACE="msp"
RELEASE_NAMESPACE="alga-system"
RESET_NAMESPACE="appliance-reset"
STORAGE_PATH="/var/mnt/alga-data/local-path-provisioner"
FLUX_NAMESPACE="flux-system"
GITOPS_SOURCE_NAME="alga-appliance"
GITOPS_KUSTOMIZATION_NAME="alga-appliance"
FORCE=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage:
  reset-appliance-data.sh --kubeconfig <path> --force [options]

Options:
  --kubeconfig <path>          Kubeconfig path
  --app-namespace <name>       Application namespace to delete (default: msp)
  --release-namespace <name>   Release namespace to delete (default: alga-system)
  --reset-namespace <name>     Temporary namespace for the wipe job (default: appliance-reset)
  --storage-path <path>        Host path used by local-path storage (default: /var/mnt/alga-data/local-path-provisioner)
  --flux-namespace <name>      Flux namespace containing appliance source objects (default: flux-system)
  --gitops-source <name>       GitRepository name to delete before reset (default: alga-appliance)
  --gitops-kustomization <name>
                               Kustomization name to delete before reset (default: alga-appliance)
  --force                      Confirm destructive wipe
  --dry-run                    Print the planned commands without mutating the cluster
  --help                       Show this help
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
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

kubectl_cmd() {
  run_cmd kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
}

namespace_exists() {
  kubectl --kubeconfig "$KUBECONFIG_PATH" get namespace "$1" >/dev/null 2>&1
}

delete_namespace() {
  local namespace="$1"

  if ! namespace_exists "$namespace"; then
    return 0
  fi

  kubectl_cmd delete namespace "$namespace" --ignore-not-found=true --wait=false

  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH wait --for=delete namespace/$namespace --timeout=10m"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" wait --for=delete "namespace/$namespace" --timeout=10m || true
}

delete_gitops_objects() {
  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n $FLUX_NAMESPACE delete kustomization.kustomize.toolkit.fluxcd.io/$GITOPS_KUSTOMIZATION_NAME --ignore-not-found=true"
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n $FLUX_NAMESPACE delete gitrepository.source.toolkit.fluxcd.io/$GITOPS_SOURCE_NAME --ignore-not-found=true"
    return 0
  fi

  if namespace_exists "$FLUX_NAMESPACE"; then
    kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$FLUX_NAMESPACE" delete "kustomization.kustomize.toolkit.fluxcd.io/$GITOPS_KUSTOMIZATION_NAME" --ignore-not-found=true >/dev/null
    kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$FLUX_NAMESPACE" delete "gitrepository.source.toolkit.fluxcd.io/$GITOPS_SOURCE_NAME" --ignore-not-found=true >/dev/null
  fi
}

delete_local_path_pvs() {
  local pv_names=""

  if ! $DRY_RUN; then
    pv_names="$(kubectl --kubeconfig "$KUBECONFIG_PATH" get pv -o json | jq -r --arg ns "$APP_NAMESPACE" '
      .items[]
      | select(.spec.storageClassName == "local-path")
      | select((.spec.claimRef.namespace // "") == $ns)
      | .metadata.name
    ')"
  fi

  if [ -z "$pv_names" ] && ! $DRY_RUN; then
    return 0
  fi

  if $DRY_RUN; then
    echo "+ delete local-path PVs bound to namespace $APP_NAMESPACE"
    return 0
  fi

  while IFS= read -r pv_name; do
    [ -n "$pv_name" ] || continue
    kubectl --kubeconfig "$KUBECONFIG_PATH" delete pv "$pv_name" --ignore-not-found=true >/dev/null
  done <<EOF
$pv_names
EOF
}

run_reset_job() {
  local manifest

  manifest="$(cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${RESET_NAMESPACE}
  labels:
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/audit: privileged
    pod-security.kubernetes.io/warn: privileged
---
apiVersion: batch/v1
kind: Job
metadata:
  name: appliance-data-reset
  namespace: ${RESET_NAMESPACE}
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: wipe
          image: busybox:1.36
          securityContext:
            privileged: true
          command:
            - sh
            - -ec
            - |
              target="/host${STORAGE_PATH}"
              mkdir -p "\$target"
              find "\$target" -mindepth 1 -maxdepth 1 -print -exec rm -rf {} +
          volumeMounts:
            - name: host-root
              mountPath: /host
      volumes:
        - name: host-root
          hostPath:
            path: /
            type: Directory
EOF
)"

  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH apply -f -"
    printf '%s\n' "$manifest"
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n $RESET_NAMESPACE wait --for=condition=complete --timeout=10m job/appliance-data-reset"
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH delete namespace $RESET_NAMESPACE --ignore-not-found=true"
    return 0
  fi

  printf '%s\n' "$manifest" | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$RESET_NAMESPACE" wait --for=condition=complete --timeout=10m job/appliance-data-reset
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$RESET_NAMESPACE" logs job/appliance-data-reset >/dev/null || true
  kubectl --kubeconfig "$KUBECONFIG_PATH" delete namespace "$RESET_NAMESPACE" --ignore-not-found=true >/dev/null
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --app-namespace)
      APP_NAMESPACE="$2"
      shift 2
      ;;
    --release-namespace)
      RELEASE_NAMESPACE="$2"
      shift 2
      ;;
    --reset-namespace)
      RESET_NAMESPACE="$2"
      shift 2
      ;;
    --storage-path)
      STORAGE_PATH="$2"
      shift 2
      ;;
    --flux-namespace)
      FLUX_NAMESPACE="$2"
      shift 2
      ;;
    --gitops-source)
      GITOPS_SOURCE_NAME="$2"
      shift 2
      ;;
    --gitops-kustomization)
      GITOPS_KUSTOMIZATION_NAME="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
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

require_command jq
require_command kubectl

if [ -z "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig path is required via --kubeconfig or KUBECONFIG." >&2
  exit 1
fi

if ! $FORCE; then
  echo "This command is destructive. Re-run with --force to wipe appliance namespaces and local-path data." >&2
  exit 1
fi

delete_gitops_objects
delete_namespace "$RELEASE_NAMESPACE"
delete_namespace "$APP_NAMESPACE"
delete_local_path_pvs
run_reset_job

echo "Appliance namespaces and local-path data were wiped."
