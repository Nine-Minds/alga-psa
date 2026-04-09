#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG:-}"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
STORAGE_MANIFEST="$REPO_ROOT/ee/appliance/manifests/local-path-storage.yaml"
STORAGE_PATH="/var/mnt/alga-data/local-path-provisioner"
SMOKE_NAMESPACE="storage-smoke"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage:
  install-storage.sh --kubeconfig <path> [options]

Options:
  --kubeconfig <path>        Kubeconfig path
  --dry-run                  Print the commands without mutating the cluster
  --help                     Show this help
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

wait_for_rollout() {
  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n local-path-storage rollout status deployment/local-path-provisioner --timeout=5m"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n local-path-storage rollout status deployment/local-path-provisioner --timeout=5m
}

prepare_storage_path() {
  local manifest

  if $DRY_RUN; then
    cat <<EOF
+ kubectl --kubeconfig $KUBECONFIG_PATH apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: local-path-storage-prepare
  namespace: local-path-storage
EOF
    return 0
  fi

  manifest="$(cat <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: local-path-storage-prepare
  namespace: local-path-storage
spec:
  ttlSecondsAfterFinished: 300
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: prepare
          image: busybox:1.36
          securityContext:
            privileged: true
          command:
            - sh
            - -ec
            - |
              mkdir -p /host${STORAGE_PATH}
              chmod 0777 /host${STORAGE_PATH}
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

  printf '%s\n' "$manifest" | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n local-path-storage wait --for=condition=complete --timeout=5m job/local-path-storage-prepare
}

run_smoke_test() {
  local manifest

  if $DRY_RUN; then
    cat <<EOF
+ kubectl --kubeconfig $KUBECONFIG_PATH create namespace $SMOKE_NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
+ kubectl --kubeconfig $KUBECONFIG_PATH label namespace $SMOKE_NAMESPACE pod-security.kubernetes.io/enforce=privileged pod-security.kubernetes.io/audit=privileged pod-security.kubernetes.io/warn=privileged --overwrite
+ kubectl --kubeconfig $KUBECONFIG_PATH apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: storage-smoke-pvc
  namespace: $SMOKE_NAMESPACE
---
apiVersion: batch/v1
kind: Job
metadata:
  name: storage-smoke
  namespace: $SMOKE_NAMESPACE
EOF
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" create namespace "$SMOKE_NAMESPACE" --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
  kubectl --kubeconfig "$KUBECONFIG_PATH" label namespace "$SMOKE_NAMESPACE" \
    pod-security.kubernetes.io/enforce=privileged \
    pod-security.kubernetes.io/audit=privileged \
    pod-security.kubernetes.io/warn=privileged \
    --overwrite

  manifest="$(cat <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: storage-smoke-pvc
  namespace: $SMOKE_NAMESPACE
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path
  resources:
    requests:
      storage: 1Gi
---
apiVersion: batch/v1
kind: Job
metadata:
  name: storage-smoke
  namespace: $SMOKE_NAMESPACE
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: smoke
          image: busybox:1.36
          command:
            - sh
            - -c
            - echo ok > /data/ready && cat /data/ready
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: storage-smoke-pvc
EOF
)"

  printf '%s\n' "$manifest" | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$SMOKE_NAMESPACE" wait --for=condition=complete --timeout=5m job/storage-smoke
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$SMOKE_NAMESPACE" logs job/storage-smoke >/dev/null
  kubectl --kubeconfig "$KUBECONFIG_PATH" delete namespace "$SMOKE_NAMESPACE" --ignore-not-found >/dev/null
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --kubeconfig)
      KUBECONFIG_PATH="$2"
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

require_command kubectl

if [ -z "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig path is required via --kubeconfig or KUBECONFIG." >&2
  exit 1
fi

if [ ! -f "$KUBECONFIG_PATH" ] && ! $DRY_RUN; then
  echo "Kubeconfig file not found: $KUBECONFIG_PATH" >&2
  exit 1
fi

if [ ! -f "$STORAGE_MANIFEST" ]; then
  echo "Storage manifest not found: $STORAGE_MANIFEST" >&2
  exit 1
fi

kubectl_cmd apply -f "$STORAGE_MANIFEST"
kubectl_cmd label namespace msp \
  pod-security.kubernetes.io/enforce=privileged \
  pod-security.kubernetes.io/audit=privileged \
  pod-security.kubernetes.io/warn=privileged \
  --overwrite

prepare_storage_path
wait_for_rollout
run_smoke_test

echo "Storage prerequisites are ready."
