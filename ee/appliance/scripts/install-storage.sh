#!/usr/bin/env bash
set -euo pipefail

KUBECONFIG_PATH="${KUBECONFIG:-}"
APPLIANCE_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
STORAGE_MANIFEST="$APPLIANCE_ROOT/manifests/local-path-storage.yaml"
STORAGE_PATH="/var/mnt/alga-data/local-path-provisioner"
K3S_CONFIG_DROP_IN="/etc/rancher/k3s/config.yaml.d/20-alga-local-storage.yaml"
SMOKE_NAMESPACE="storage-smoke"
LOCK_DIR="${ALGA_APPLIANCE_STORAGE_LOCK_DIR:-/var/lib/alga-appliance/storage-reconcile.lock}"
DRY_RUN=false
KUBE_COMMAND=()

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

acquire_lock() {
  if $DRY_RUN; then
    return 0
  fi

  local attempts=0
  mkdir -p "$(dirname "$LOCK_DIR")"
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 150 ]; then
      echo "Timed out waiting for another storage reconciliation to finish." >&2
      exit 1
    fi
    sleep 2
  done
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM
}

configure_kube_command() {
  if command -v kubectl >/dev/null 2>&1; then
    KUBE_COMMAND=(kubectl)
  elif [ -x "$APPLIANCE_ROOT/bin/k3s" ]; then
    KUBE_COMMAND=("$APPLIANCE_ROOT/bin/k3s" kubectl)
  elif command -v k3s >/dev/null 2>&1; then
    KUBE_COMMAND=(k3s kubectl)
  else
    echo "kubectl or k3s is required" >&2
    exit 1
  fi
}

kube() {
  "${KUBE_COMMAND[@]}" --kubeconfig "$KUBECONFIG_PATH" "$@"
}

kubectl_cmd() {
  run_cmd "${KUBE_COMMAND[@]}" --kubeconfig "$KUBECONFIG_PATH" "$@"
}

wait_for_rollout() {
  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH -n local-path-storage rollout status deployment/local-path-provisioner --timeout=5m"
    return 0
  fi

  kube -n local-path-storage rollout status deployment/local-path-provisioner --timeout=5m
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
              mkdir -p "/host$(dirname "${K3S_CONFIG_DROP_IN}")"
              cat > "/host${K3S_CONFIG_DROP_IN}" <<'CONFIG'
              disable+:
                - local-storage
              CONFIG
              K3S_SERVICE=/host/etc/systemd/system/k3s.service
              if [ -f "\$K3S_SERVICE" ] \
                && grep -q -- '--disable servicelb' "\$K3S_SERVICE" \
                && ! grep -q -- '--disable local-storage' "\$K3S_SERVICE"; then
                sed -i 's/--disable servicelb/--disable servicelb --disable local-storage/' "\$K3S_SERVICE"
              fi
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

  kube -n local-path-storage delete job local-path-storage-prepare --ignore-not-found --wait=true >/dev/null
  printf '%s\n' "$manifest" | kube apply -f -
  kube -n local-path-storage wait --for=condition=complete --timeout=5m job/local-path-storage-prepare
}

reconcile_existing_storage_class() {
  if $DRY_RUN; then
    echo "+ preserve existing local-path PVs and replace an incompatible StorageClass"
    return 0
  fi

  local pv_name
  while IFS= read -r pv_name; do
    [ -n "$pv_name" ] || continue
    echo "Protecting existing local-path PV $pv_name with Retain policy."
    kube patch persistentvolume "$pv_name" --type=merge -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
  done < <(kube get pv -o jsonpath='{range .items[?(@.spec.storageClassName=="local-path")]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)

  if ! kube get storageclass local-path >/dev/null 2>&1; then
    return 0
  fi

  local reclaim_policy=""
  reclaim_policy="$(kube get storageclass local-path -o jsonpath='{.reclaimPolicy}' 2>/dev/null || true)"
  if [ "$reclaim_policy" = "Retain" ]; then
    return 0
  fi

  echo "Replacing local-path StorageClass with appliance Retain policy."
  kube delete storageclass local-path
}

remove_k3s_bundled_provisioner() {
  if $DRY_RUN; then
    echo "+ remove kube-system/local-path-provisioner after preserving existing local-path volumes"
    return 0
  fi

  # k3s normally installs this controller automatically. The appliance owns a
  # separately configured controller using the same provisioner name, so
  # leaving both active lets two controllers race for every local-path claim.
  # The prepare job persists the disable flag in both k3s configuration and the
  # appliance's existing systemd unit so the bundled controller stays disabled
  # after the next host restart.
  kube -n kube-system delete deployment local-path-provisioner --ignore-not-found --wait=true
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

  kube delete namespace "$SMOKE_NAMESPACE" --ignore-not-found --wait=true >/dev/null
  kube create namespace "$SMOKE_NAMESPACE" --dry-run=client -o yaml | kube apply -f -
  kube label namespace "$SMOKE_NAMESPACE" \
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

  printf '%s\n' "$manifest" | kube apply -f -
  kube -n "$SMOKE_NAMESPACE" wait --for=condition=complete --timeout=5m job/storage-smoke
  kube -n "$SMOKE_NAMESPACE" logs job/storage-smoke >/dev/null
  kube delete namespace "$SMOKE_NAMESPACE" --ignore-not-found >/dev/null
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

configure_kube_command
acquire_lock
if $DRY_RUN; then
  echo "+ kubectl --kubeconfig $KUBECONFIG_PATH create namespace local-path-storage --dry-run=client -o yaml | kubectl --kubeconfig $KUBECONFIG_PATH apply -f -"
else
  kube create namespace local-path-storage --dry-run=client -o yaml | kube apply -f -
fi
kubectl_cmd label namespace local-path-storage \
  pod-security.kubernetes.io/enforce=privileged \
  pod-security.kubernetes.io/audit=privileged \
  pod-security.kubernetes.io/warn=privileged \
  --overwrite
prepare_storage_path
reconcile_existing_storage_class
remove_k3s_bundled_provisioner
kubectl_cmd apply -f "$STORAGE_MANIFEST"
if $DRY_RUN; then
  echo "+ kubectl --kubeconfig $KUBECONFIG_PATH create namespace msp --dry-run=client -o yaml | kubectl --kubeconfig $KUBECONFIG_PATH apply -f -"
else
  kube create namespace msp --dry-run=client -o yaml | kube apply -f -
fi
kubectl_cmd label namespace msp \
  pod-security.kubernetes.io/enforce=privileged \
  pod-security.kubernetes.io/audit=privileged \
  pod-security.kubernetes.io/warn=privileged \
  --overwrite

wait_for_rollout
run_smoke_test

echo "Storage prerequisites are ready."
