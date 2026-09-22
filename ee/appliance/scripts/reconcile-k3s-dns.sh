#!/usr/bin/env bash
set -euo pipefail

# Reconcile the host cluster resolver from the control plane.
#
# The control-plane pod runs as UID 10001 with no host-root mount, so it cannot
# write /etc/rancher/k3s itself. Following the storage prepare-job precedent,
# this launcher creates a narrowly scoped privileged Job that mounts host root
# and runs the fixed helper (configure-k3s-dns.sh) with only validated DNS
# configuration. The Job uses the currently running control-plane image, cached
# on the node with IfNotPresent, so a broken resolver cannot block the pull.

KUBECTL_BIN="${ALGA_APPLIANCE_KUBECTL:-kubectl}"
KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
# The reconcile Job runs privileged with host root mounted, so it must live in
# the privileged support plane rather than the control-plane namespace.
JOB_NAMESPACE="${ALGA_APPLIANCE_DNS_JOB_NAMESPACE:-alga-appliance-support}"
JOB_NAME="${ALGA_APPLIANCE_DNS_JOB_NAME:-alga-appliance-dns-reconcile}"
# Runs under the namespace default service account: the helper performs its
# rollouts through the host k3s admin kubeconfig, so the pod needs no extra RBAC.
JOB_SA="${ALGA_APPLIANCE_DNS_JOB_SA:-default}"
CONTROL_PLANE_DEPLOYMENT="${ALGA_APPLIANCE_CONTROL_PLANE_DEPLOYMENT:-appliance-control-plane}"
HELPER_PATH="${ALGA_APPLIANCE_DNS_HELPER_PATH:-/opt/alga-appliance/scripts/configure-k3s-dns.sh}"
JOB_TIMEOUT_SECONDS="${ALGA_APPLIANCE_DNS_JOB_TIMEOUT_SECONDS:-900}"
DRY_RUN=false
WAIT=true

usage() {
  cat <<'EOF'
Usage: reconcile-k3s-dns.sh [options]

Options:
  --kubeconfig <path>  Kubeconfig path
  --no-wait            Trigger the reconcile Job and return without waiting; used
                       by the periodic reconciler, whose host is restarted by the
                       activation itself
  --dry-run            Print the reconcile Job manifest without applying it
  --help               Show this help

Environment:
  ALGA_APPLIANCE_CONTROL_PLANE_IMAGE   Override the image (defaults to the
                                       running control-plane Deployment image)
EOF
}

log() { printf '%s\n' "$*"; }

resolve_control_plane_image() {
  if [ -n "${ALGA_APPLIANCE_CONTROL_PLANE_IMAGE:-}" ]; then
    printf '%s' "$ALGA_APPLIANCE_CONTROL_PLANE_IMAGE"
    return 0
  fi
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n alga-appliance-control-plane \
    get deployment "$CONTROL_PLANE_DEPLOYMENT" \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null
}

# Ensure the privileged support namespace exists and admits the host-root Job.
ensure_namespace() {
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" get namespace "$JOB_NAMESPACE" >/dev/null 2>&1 \
    || "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" create namespace "$JOB_NAMESPACE" >/dev/null
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" label namespace "$JOB_NAMESPACE" \
    pod-security.kubernetes.io/enforce=privileged \
    pod-security.kubernetes.io/audit=privileged \
    pod-security.kubernetes.io/warn=privileged \
    --overwrite >/dev/null
}

build_manifest() {
  local image="$1"
  cat <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${JOB_NAME}
  namespace: ${JOB_NAMESPACE}
  labels:
    app.kubernetes.io/name: alga-appliance-dns-reconcile
    app.kubernetes.io/part-of: alga-appliance
spec:
  ttlSecondsAfterFinished: 300
  backoffLimit: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: alga-appliance-dns-reconcile
    spec:
      restartPolicy: Never
      serviceAccountName: ${JOB_SA}
      hostPID: true
      hostNetwork: true
      containers:
        - name: reconcile
          image: ${image}
          imagePullPolicy: IfNotPresent
          securityContext:
            privileged: true
          command:
            - bash
            - ${HELPER_PATH}
            - --host-root
            - /host
            - --activate
          env:
            - name: ALGA_APPLIANCE_DNS_ROOT
              value: /host
            - name: ALGA_APPLIANCE_KUBECONFIG
              value: /host/etc/rancher/k3s/k3s.yaml
            - name: ALGA_APPLIANCE_DNS_RESTART_COMMAND
              value: nsenter -t 1 -m -u -i -n -p -- systemctl restart k3s
          volumeMounts:
            - name: host-root
              mountPath: /host
      volumes:
        - name: host-root
          hostPath:
            path: /
            type: Directory
EOF
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
    --no-wait)
      WAIT=false
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

IMAGE="$(resolve_control_plane_image)"
if [ -z "$IMAGE" ]; then
  echo "Could not determine the running control-plane image for DNS reconciliation." >&2
  exit 1
fi

MANIFEST="$(build_manifest "$IMAGE")"

if $DRY_RUN; then
  printf '%s\n' "$MANIFEST"
  exit 0
fi

log "Reconciling cluster DNS with the running control-plane image $IMAGE."
ensure_namespace
"$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" \
  delete job "$JOB_NAME" --ignore-not-found --wait=true >/dev/null
printf '%s\n' "$MANIFEST" | "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" apply -f -

if ! $WAIT; then
  log "DNS reconciliation job $JOB_NAME triggered; activation continues on the host."
  exit 0
fi

if ! "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" \
  wait --for=condition=complete --timeout="${JOB_TIMEOUT_SECONDS}s" "job/$JOB_NAME"; then
  echo "DNS reconciliation job $JOB_NAME failed or timed out; recent logs:" >&2
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" logs "job/$JOB_NAME" --tail=200 >&2 || true
  exit 1
fi

log "DNS reconciliation completed."
