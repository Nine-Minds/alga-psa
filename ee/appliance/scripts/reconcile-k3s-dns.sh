#!/usr/bin/env bash
set -euo pipefail

# Reconcile the host cluster resolver from the control plane.
#
# The control-plane pod runs as UID 10001 with no host-root mount, so it cannot
# write /etc/rancher/k3s or restart k3s. Following the storage prepare-job
# precedent, this launcher creates a narrowly scoped privileged Job that:
#   1. runs as UID 0 with host root and host PID (the image defaults to 10001),
#   2. stages the fixed DNS helper and a kubectl wrapper onto the host,
#   3. launches a host-owned transient systemd service that owns the lock,
#      restart, readiness checks, rollout and the durable activation record.
# Because activation is host-owned it survives this Job, the control plane, and
# a control-plane replacement. The Job only stages and triggers; callers read the
# durable activation status from the shared hostPath.
#
# The Job uses the currently running control-plane image (identified by the pod's
# imageID when available) with IfNotPresent so a broken resolver cannot block a
# registry pull.

KUBECTL_BIN="${ALGA_APPLIANCE_KUBECTL:-kubectl}"
KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
# The reconcile Job runs privileged with host root mounted, so it must live in
# the privileged support plane rather than the control-plane namespace.
JOB_NAMESPACE="${ALGA_APPLIANCE_DNS_JOB_NAMESPACE:-alga-appliance-support}"
JOB_NAME="${ALGA_APPLIANCE_DNS_JOB_NAME:-alga-appliance-dns-reconcile}"
# Runs under the namespace default service account: the helper performs its
# rollouts through the host k3s admin kubeconfig, so the pod needs no extra RBAC.
JOB_SA="${ALGA_APPLIANCE_DNS_JOB_SA:-default}"
CONTROL_PLANE_NAMESPACE="${ALGA_APPLIANCE_CONTROL_PLANE_NAMESPACE:-alga-appliance-control-plane}"
CONTROL_PLANE_DEPLOYMENT="${ALGA_APPLIANCE_CONTROL_PLANE_DEPLOYMENT:-appliance-control-plane}"
IMAGE_PULL_POLICY="${ALGA_APPLIANCE_DNS_IMAGE_PULL_POLICY:-IfNotPresent}"
# The requested resolver-configuration fingerprint (mode + ordered custom
# servers) computed by the control plane from the persisted setup inputs. The
# host helper recomputes it from the same file and refuses to record a different
# configuration as active, so the submission and the activation cannot drift.
DNS_CONFIG_FINGERPRINT="${ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT:-}"
HOST_STAGE_DIR="${ALGA_APPLIANCE_DNS_STAGE_DIR:-/var/lib/alga-appliance/dns}"
ACTIVATION_UNIT="${ALGA_APPLIANCE_DNS_UNIT:-alga-appliance-dns-activate}"
JOB_TIMEOUT_SECONDS="${ALGA_APPLIANCE_DNS_JOB_TIMEOUT_SECONDS:-180}"
DRY_RUN=false
WAIT=true

usage() {
  cat <<'EOF'
Usage: reconcile-k3s-dns.sh [options]

Options:
  --kubeconfig <path>  Kubeconfig path
  --no-wait            Apply the staging Job and return without waiting
  --dry-run            Print the reconcile Job manifest without applying it
  --help               Show this help

Environment:
  ALGA_APPLIANCE_CONTROL_PLANE_IMAGE   Override the image (defaults to the
                                       running control-plane image/digest)
EOF
}

log() { printf '%s\n' "$*"; }

# Prefer the running container's imageID (immutable digest); fall back to the
# Deployment spec image.
resolve_control_plane_image() {
  if [ -n "${ALGA_APPLIANCE_CONTROL_PLANE_IMAGE:-}" ]; then
    printf '%s' "$ALGA_APPLIANCE_CONTROL_PLANE_IMAGE"
    return 0
  fi
  local image
  # Prefer the pod that is actually running: an upgrade briefly leaves the
  # previous (Completed/Terminating) pod in the list, and selecting it would run
  # the reconcile Job with a stale image that lacks the current helper.
  image="$("$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$CONTROL_PLANE_NAMESPACE" \
    get pods -l app.kubernetes.io/name=appliance-control-plane \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[0].status.containerStatuses[0].imageID}' 2>/dev/null || true)"
  if [ -z "$image" ]; then
    image="$("$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$CONTROL_PLANE_NAMESPACE" \
      get deployment "$CONTROL_PLANE_DEPLOYMENT" \
      -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
  fi
  printf '%s' "$image"
}

ensure_namespace() {
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" get namespace "$JOB_NAMESPACE" >/dev/null 2>&1 \
    || "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" create namespace "$JOB_NAMESPACE" >/dev/null
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" label namespace "$JOB_NAMESPACE" \
    pod-security.kubernetes.io/enforce=privileged \
    pod-security.kubernetes.io/audit=privileged \
    pod-security.kubernetes.io/warn=privileged \
    --overwrite >/dev/null
}

# True when a previous staging Job is still running; we never delete active work.
job_is_active() {
  local active
  active="$("$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" \
    get job "$JOB_NAME" -o jsonpath='{.status.active}' 2>/dev/null || true)"
  [ -n "$active" ] && [ "$active" != "0" ]
}

# The container command is assembled from a quoted, indentation-neutral heredoc
# and then uniformly re-indented for the YAML literal block. Building it inline
# in the manifest would put the nested heredoc terminator at column zero and
# break the block scalar (the manifest would not parse as YAML).
container_command() {
  cat <<'CONTAINER_COMMAND'
set -euo pipefail
if ! command -v nsenter >/dev/null 2>&1; then
  echo "nsenter is not available in the control-plane image" >&2
  exit 1
fi
# Enter the host namespaces AND switch the root filesystem to the host root.
# Entering the mount namespace alone leaves the process root at the container
# image, so host tools (/bin/sh, systemctl, systemd-run) are neither found nor
# executed; --root opens the host root before the namespace switch and chroots
# into it, and --wdns starts the command at that root. The mount is the Job's
# /host hostPath; the host root persists for the staged helper and host unit.
host_nsenter() {
  nsenter -t 1 -m -u -i -n -p --root=__HOST_ROOT__ --wdns=/ -- "$@"
}
# `command -v` is a shell builtin: it must be run by an explicit host shell, not
# handed to nsenter as if it were an executable.
if ! host_nsenter /bin/sh -c 'command -v systemd-run >/dev/null 2>&1'; then
  echo "host systemd-run is not available; cannot launch a host-owned activation service" >&2
  exit 1
fi
stage="__HOST_ROOT__/__HOST_STAGE_DIR__"
stage_path="__HOST_STAGE_DIR__"
mkdir -p "$stage"
install -m 0755 __HELPER_SOURCE__ "$stage/configure-k3s-dns.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'for candidate in /usr/local/bin/k3s /opt/alga-appliance/bin/k3s /usr/bin/k3s; do' \
  '  if [ -x "$candidate" ]; then exec "$candidate" kubectl "$@"; fi' \
  'done' \
  'echo "k3s binary not found on host" >&2' \
  'exit 1' > "$stage/kubectl"
chmod 0755 "$stage/kubectl"
if host_nsenter systemctl is-active --quiet "__ACTIVATION_UNIT__"; then
  echo "DNS activation service is already running; nothing to do."
  exit 0
fi
host_nsenter systemctl reset-failed "__ACTIVATION_UNIT__" >/dev/null 2>&1 || true
host_nsenter systemd-run \
  --unit="__ACTIVATION_UNIT__" \
  --collect \
  --property=Type=oneshot \
  --property=TimeoutStartSec=1800 \
  --property=WorkingDirectory=/ \
  --setenv="ALGA_APPLIANCE_KUBECTL=${stage_path}/kubectl" \
  --setenv="ALGA_APPLIANCE_KUBECONFIG=/etc/rancher/k3s/k3s.yaml" \
  --setenv="ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT=__DNS_CONFIG_FINGERPRINT__" \
  /bin/bash "${stage_path}/configure-k3s-dns.sh" --activate
echo "Launched host-owned DNS activation service __ACTIVATION_UNIT__."
CONTAINER_COMMAND
}

build_manifest() {
  local image="$1"
  local host_root="${ALGA_APPLIANCE_DNS_JOB_HOST_ROOT:-/host}"
  local helper_source="${ALGA_APPLIANCE_DNS_HELPER_SOURCE:-/opt/alga-appliance/scripts/configure-k3s-dns.sh}"
  local command
  command="$(container_command)"
  command="${command//__HOST_ROOT__/$host_root}"
  command="${command//__HOST_STAGE_DIR__/$HOST_STAGE_DIR}"
  command="${command//__HELPER_SOURCE__/$helper_source}"
  command="${command//__ACTIVATION_UNIT__/$ACTIVATION_UNIT}"
  command="${command//__DNS_CONFIG_FINGERPRINT__/$DNS_CONFIG_FINGERPRINT}"
  local indented
  indented="$(printf '%s\n' "$command" | sed 's/^/              /')"
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
      securityContext:
        runAsUser: 0
        runAsGroup: 0
      containers:
        - name: reconcile
          image: ${image}
          imagePullPolicy: ${IMAGE_PULL_POLICY}
          securityContext:
            privileged: true
            runAsUser: 0
            runAsGroup: 0
          command:
            - bash
            - -c
            - |
${indented}
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
    --no-wait)
      WAIT=false
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

IMAGE="$(resolve_control_plane_image)"
if [ -z "$IMAGE" ]; then
  echo "Could not determine the running control-plane image for DNS reconciliation." >&2
  exit 1
fi

if [ -n "$DNS_CONFIG_FINGERPRINT" ] && ! printf '%s' "$DNS_CONFIG_FINGERPRINT" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT must be a 64-character hex sha256." >&2
  exit 1
fi

MANIFEST="$(build_manifest "$IMAGE")"

if $DRY_RUN; then
  printf '%s\n' "$MANIFEST"
  exit 0
fi

if job_is_active; then
  log "DNS reconcile Job $JOB_NAME is already active; leaving it in place."
  exit 0
fi

log "Staging cluster DNS reconciliation with control-plane image $IMAGE."
ensure_namespace
"$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" \
  delete job "$JOB_NAME" --ignore-not-found --wait=true >/dev/null
printf '%s\n' "$MANIFEST" | "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" apply -f -

if ! $WAIT; then
  log "DNS reconcile Job $JOB_NAME applied; activation continues on the host."
  exit 0
fi

if ! "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" \
  wait --for=condition=complete --timeout="${JOB_TIMEOUT_SECONDS}s" "job/$JOB_NAME"; then
  echo "DNS reconcile staging Job $JOB_NAME failed or timed out; recent logs:" >&2
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$JOB_NAMESPACE" logs "job/$JOB_NAME" --tail=200 >&2 || true
  exit 1
fi

log "DNS reconcile Job completed; host-owned activation continues in ${ACTIVATION_UNIT}."
