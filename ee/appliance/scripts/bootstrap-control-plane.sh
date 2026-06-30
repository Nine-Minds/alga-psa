#!/usr/bin/env bash
set -euo pipefail

APPLIANCE_ROOT="${ALGA_APPLIANCE_ROOT:-/opt/alga-appliance}"
KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
SETUP_PORT="${ALGA_APPLIANCE_PORT:-8080}"
TOKEN_FILE="${ALGA_APPLIANCE_TOKEN_FILE:-/var/lib/alga-appliance/setup-token}"
K3S_READY_TIMEOUT_SECONDS="${ALGA_K3S_READY_TIMEOUT_SECONDS:-180}"
DRY_RUN=false
CONTROL_PLANE_ONLY=false

usage() {
  cat <<'EOF'
Usage:
  bootstrap-control-plane.sh [options]

Bootstraps the new-install Kubernetes substrate and hands setup to the
Kubernetes-hosted appliance control plane. This script is intentionally limited
to k3s readiness, baked image import, local manifest apply, and setup/fallback
handoff reporting.

Options:
  --appliance-root <path>  Installed appliance root (default: /opt/alga-appliance)
  --kubeconfig <path>      k3s kubeconfig path (default: /etc/rancher/k3s/k3s.yaml)
  --token-file <path>      Setup token file (default: /var/lib/alga-appliance/setup-token)
  --port <port>            Setup UI host port (default: 8080)
  --control-plane-only     Re-apply only the control plane (channel upgrade): re-resolve
                           the channel-pinned image and apply it; skip k3s/import/storage
  --dry-run                Print the planned operations without mutating the host
  --help                   Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --appliance-root)
      APPLIANCE_ROOT="$2"
      shift 2
      ;;
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --token-file)
      TOKEN_FILE="$2"
      shift 2
      ;;
    --port)
      SETUP_PORT="$2"
      shift 2
      ;;
    --control-plane-only)
      CONTROL_PLANE_ONLY=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

CONTROL_PLANE_DIR="$APPLIANCE_ROOT/control-plane"
IMAGE_DIR="$CONTROL_PLANE_DIR/images"
CONTROL_PLANE_MANIFESTS="$CONTROL_PLANE_DIR/manifests"
LOCAL_STORAGE_MANIFEST="$APPLIANCE_ROOT/manifests/local-path-storage.yaml"
STORAGE_INSTALL_SCRIPT="$APPLIANCE_ROOT/scripts/install-storage.sh"
FALLBACK_COMMAND="$APPLIANCE_ROOT/bin/alga-control-plane-reapply"
BUNDLED_K3S_BINARY="$APPLIANCE_ROOT/bin/k3s"
CONTROL_PLANE_NAMESPACE="alga-appliance-control-plane"
CONTROL_PLANE_DEPLOYMENT="appliance-control-plane"
BAKED_CONTROL_PLANE_IMAGE="localhost/alga-appliance-control-plane"
HOST_SERVICE_DIR="$APPLIANCE_ROOT/host-service"
CONTROL_PLANE_RESOLVER="$HOST_SERVICE_DIR/resolve-control-plane-image.mjs"
RELEASE_SELECTION_FILE="${ALGA_APPLIANCE_RELEASE_SELECTION_FILE:-/var/lib/alga-appliance/release-selection.json}"
BUNDLED_NODE_BINARY="$APPLIANCE_ROOT/bin/node"

log() {
  printf '[alga-bootstrap] %s\n' "$*"
}

plan() {
  printf '[plan] %s\n' "$*"
}

run() {
  if [ "$DRY_RUN" = "true" ]; then
    plan "$*"
  else
    log "$*"
    "$@"
  fi
}

require_file() {
  if [ ! -f "$1" ]; then
    echo "Required file not found: $1" >&2
    exit 1
  fi
}

require_dir() {
  if [ ! -d "$1" ]; then
    echo "Required directory not found: $1" >&2
    exit 1
  fi
}

k3s_cmd() {
  if [ -x "$BUNDLED_K3S_BINARY" ]; then
    "$BUNDLED_K3S_BINARY" "$@"
  elif command -v k3s >/dev/null 2>&1; then
    k3s "$@"
  else
    echo "k3s command is unavailable" >&2
    return 127
  fi
}

kubectl_cmd() {
  if command -v kubectl >/dev/null 2>&1; then
    kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
  else
    k3s_cmd kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
  fi
}

detect_ip() {
  local ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "$ip" ]; then
    ip="127.0.0.1"
  fi
  printf '%s\n' "$ip"
}

ensure_k3s_started() {
  log "Substrate: ensuring k3s is installed and running"
  if [ "$DRY_RUN" = "true" ]; then
    plan "ensure k3s service is enabled and running with minimal local substrate options"
    return 0
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files k3s.service >/dev/null 2>&1; then
    systemctl enable --now k3s
    return 0
  fi

  local k3s_bin=""
  if [ -x "$BUNDLED_K3S_BINARY" ]; then
    k3s_bin="$BUNDLED_K3S_BINARY"
  elif command -v k3s >/dev/null 2>&1; then
    k3s_bin="$(command -v k3s)"
  fi

  if [ -n "$k3s_bin" ]; then
    if command -v systemctl >/dev/null 2>&1; then
      cat > /etc/systemd/system/k3s.service <<EOF
[Unit]
Description=Lightweight Kubernetes
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=$k3s_bin server --disable traefik --disable servicelb --write-kubeconfig-mode 0644
KillMode=process
Delegate=yes
Restart=always
RestartSec=5s
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable --now k3s
      return 0
    fi

    mkdir -p /var/log
    nohup "$k3s_bin" server --disable traefik --disable servicelb --write-kubeconfig-mode 0644 >/var/log/alga-appliance-k3s.log 2>&1 &
    return 0
  fi

  echo "k3s is not installed and no bundled k3s binary is available at $BUNDLED_K3S_BINARY. The ISO must stage k3s before this script runs." >&2
  exit 1
}

wait_for_kubernetes_api() {
  log "Substrate: waiting for Kubernetes API"
  if [ "$DRY_RUN" = "true" ]; then
    plan "wait for kubectl --kubeconfig $KUBECONFIG_PATH get --raw=/readyz"
    return 0
  fi

  local deadline=$((SECONDS + K3S_READY_TIMEOUT_SECONDS))
  until kubectl_cmd get --raw=/readyz >/dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for Kubernetes API after ${K3S_READY_TIMEOUT_SECONDS}s" >&2
      exit 1
    fi
    sleep 3
  done
}

import_control_plane_images() {
  log "Control plane: importing baked image archives"
  require_dir "$IMAGE_DIR"
  if ! compgen -G "$IMAGE_DIR/*.tar" >/dev/null; then
    echo "No control-plane image archives found in $IMAGE_DIR" >&2
    exit 1
  fi

  local archive
  for archive in "$IMAGE_DIR"/*.tar; do
    if [ "$DRY_RUN" = "true" ]; then
      plan "k3s ctr images import $archive"
    else
      log "k3s ctr images import $archive"
      k3s_cmd ctr images import "$archive"
    fi
  done
}

apply_local_storage() {
  log "Control plane: applying local-path storage manifest without waiting for image pulls"
  require_file "$LOCAL_STORAGE_MANIFEST"
  if [ "$DRY_RUN" = "true" ]; then
    plan "kubectl --kubeconfig $KUBECONFIG_PATH apply -f $LOCAL_STORAGE_MANIFEST || true"
    return 0
  fi

  if ! kubectl_cmd apply -f "$LOCAL_STORAGE_MANIFEST"; then
    log "local-path storage manifest apply was not clean; setup UI will still start and setup workflow will reconcile storage later"
  fi
}

node_bin() {
  if [ -x "$BUNDLED_NODE_BINARY" ]; then
    printf '%s\n' "$BUNDLED_NODE_BINARY"
  elif command -v node >/dev/null 2>&1; then
    command -v node
  else
    return 1
  fi
}

# Best-effort: print the channel-pinned control-plane image ref from the OCI
# release manifest, or nothing. Never fails the boot (registry-metadata design).
resolve_control_plane_image() {
  local node=""
  if ! node="$(node_bin)"; then
    log "node unavailable; using baked control-plane baseline" >&2
    return 0
  fi
  if [ ! -f "$CONTROL_PLANE_RESOLVER" ]; then
    log "resolver $CONTROL_PLANE_RESOLVER missing; using baked control-plane baseline" >&2
    return 0
  fi
  "$node" "$CONTROL_PLANE_RESOLVER" --selection-file "$RELEASE_SELECTION_FILE" 2>/dev/null \
    | head -n1 | tr -d '[:space:]'
}

# Generate a kustomize overlay (printed dir) that bases on the control-plane
# manifests and overrides the baked image with $1 (repo:tag or repo@sha256:..).
# A single apply with the right image avoids a baked->registry rollout flap.
control_plane_image_overlay() {
  local ref="$1" overlay name digest tag
  overlay="$(mktemp -d -t alga-cp-overlay-XXXXXX)"
  # Copy the base manifests in as a relative resource -- kubectl apply -k forbids
  # referencing paths outside the kustomization root (root-only load restriction).
  mkdir -p "$overlay/base"
  cp -R "$CONTROL_PLANE_MANIFESTS"/. "$overlay/base"/
  case "$ref" in
    *@sha256:*) name="${ref%@*}"; digest="${ref##*@}" ;;
    *) name="${ref%:*}"; tag="${ref##*:}" ;;
  esac
  {
    printf 'apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - base\nimages:\n  - name: %s\n    newName: %s\n' \
      "$BAKED_CONTROL_PLANE_IMAGE" "$name"
    if [ -n "${digest:-}" ]; then
      printf '    digest: %s\n' "$digest"
    else
      printf '    newTag: %s\n' "$tag"
    fi
  } > "$overlay/kustomization.yaml"
  printf '%s\n' "$overlay"
}

# Print the image the control-plane Deployment is currently running, or empty if
# the Deployment does not exist yet (true first boot). Used so a transient
# registry failure holds the running image instead of downgrading it.
current_control_plane_image() {
  kubectl_cmd get deployment "$CONTROL_PLANE_DEPLOYMENT" \
    -n "$CONTROL_PLANE_NAMESPACE" \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true
}

# True when $1 is already in the local containerd image store, so it can be
# applied without a registry round-trip (the Deployment pulls IfNotPresent).
control_plane_image_present_locally() {
  local ref="$1"
  [ -n "$ref" ] || return 1
  k3s_cmd ctr images ls -q 2>/dev/null | grep -Fxq "$ref"
}

# True when $1 is empty or refers to the baked baseline image.
is_baked_control_plane_image() {
  local ref="$1"
  [ -z "$ref" ] || [ "$ref" = "$BAKED_CONTROL_PLANE_IMAGE" ] || [ "$ref" = "$BAKED_CONTROL_PLANE_IMAGE:baked" ]
}

# Apply the control-plane manifests with the image overridden to $1. When $1 is
# empty or the baked baseline, apply the baseline manifests unchanged. Returns
# non-zero only when the kubectl apply itself fails.
apply_control_plane_with_image() {
  local ref="$1" overlay rc
  if is_baked_control_plane_image "$ref"; then
    log "kubectl apply -k $CONTROL_PLANE_MANIFESTS (baked baseline)"
    kubectl_cmd apply -k "$CONTROL_PLANE_MANIFESTS"
    return $?
  fi
  overlay="$(control_plane_image_overlay "$ref")"
  log "kubectl apply -k (control-plane image -> $ref)"
  kubectl_cmd apply -k "$overlay"
  rc=$?
  rm -rf "$overlay"
  return $rc
}

apply_control_plane() {
  log "Control plane: applying Kubernetes-hosted setup/status manifests"
  require_dir "$CONTROL_PLANE_MANIFESTS"
  require_file "$TOKEN_FILE"
  if [ "$DRY_RUN" = "true" ]; then
    plan "kubectl --kubeconfig $KUBECONFIG_PATH apply -f $CONTROL_PLANE_MANIFESTS/namespace.yaml"
  else
    log "kubectl apply -f $CONTROL_PLANE_MANIFESTS/namespace.yaml"
    kubectl_cmd apply -f "$CONTROL_PLANE_MANIFESTS/namespace.yaml"
  fi
  # The setup token is read by the control-plane pod directly from the shared
  # host volume (/var/lib/alga-appliance/setup-token, hostPath-mounted), so no
  # Kubernetes Secret is created here. This keeps the host-side reset CLI a pure
  # filesystem operation with no kubectl/secret-sync round trip.
  if [ "$DRY_RUN" = "true" ]; then
    plan "resolve channel-pinned control-plane image; prefer local cache; hold current image on registry failure; baked baseline only on first boot"
    plan "kubectl --kubeconfig $KUBECONFIG_PATH apply -k $CONTROL_PLANE_MANIFESTS"
    return 0
  fi

  # Registry-metadata: prefer the channel-pinned control-plane image so setup-UI /
  # host-service updates ship via the registry (no ISO re-burn). Reboots must be
  # deterministic and offline-safe, so a transient ghcr failure must NEVER
  # downgrade an already-updated control plane back to the baked baseline (that
  # regression silently reverted the setup UI to the old "Setup" view on reboot).
  # Selection order:
  #   1. live-resolved channel image, if it is already cached locally or can be
  #      pulled now -- this is how updates roll out and steady state holds;
  #   2. otherwise the image the Deployment already runs, when it is not baked
  #      (HOLD: a registry hiccup keeps the last-good image instead of rolling
  #      back -- also the only path an air-gapped appliance ever takes);
  #   3. the baked baseline only on a true first boot (no Deployment yet) or when
  #      the Deployment is already on the baked image.
  local resolved current
  resolved="$(resolve_control_plane_image || true)"
  current="$(current_control_plane_image)"

  if [ -n "${resolved:-}" ] && ! is_baked_control_plane_image "$resolved"; then
    log "resolved channel control-plane image: $resolved"
    if control_plane_image_present_locally "$resolved"; then
      log "channel image already cached locally; applying without a registry pull"
      if apply_control_plane_with_image "$resolved"; then return 0; fi
      log "apply of locally-cached channel image failed"
    elif k3s_cmd ctr images pull "$resolved" >/dev/null 2>&1; then
      if apply_control_plane_with_image "$resolved"; then return 0; fi
      log "apply of pulled channel image failed"
    else
      log "could not pull $resolved (registry unreachable / not public?)"
    fi
  else
    log "no channel control-plane image resolved (registry unreachable?)"
  fi

  # Did not land a channel image. Do NOT downgrade: hold the current non-baked
  # image when the Deployment already runs one.
  if [ -n "${current:-}" ] && ! is_baked_control_plane_image "$current"; then
    log "holding current control-plane image (no downgrade): $current"
    if apply_control_plane_with_image "$current"; then return 0; fi
    log "hold apply failed; falling back to baked baseline"
  fi

  log "applying baked baseline control-plane image (first boot or already baseline)"
  apply_control_plane_with_image ""
}

report_handoff() {
  log "Handoff: setup UI should be available from the Kubernetes-hosted control plane"
  local ip token
  ip="$(detect_ip)"
  token="<pending>"
  if [ -f "$TOKEN_FILE" ]; then
    token="$(tr -d '\n' < "$TOKEN_FILE")"
  fi

  cat <<EOF
Alga Appliance bootstrap layers:
  1. k3s substrate: ready
  2. baked control plane: applied from $CONTROL_PLANE_MANIFESTS
  3. setup handoff: http://$ip:$SETUP_PORT/

One-time setup token: $token
Fallback recovery: sudo $FALLBACK_COMMAND
Logs: sudo journalctl -u alga-appliance-bootstrap.service -u k3s -f
EOF
}

if [ "$CONTROL_PLANE_ONLY" = "true" ]; then
  # Self-service control-plane upgrade (host-agent driven): re-resolve the
  # channel-pinned control-plane image and re-apply only the control plane.
  # k3s is already up, baked images are already imported, and local-path storage
  # is already applied, so skip those steps. apply_control_plane pulls the new
  # digest and applies the kustomize overlay, which triggers the Recreate.
  wait_for_kubernetes_api
  apply_control_plane
  log "control-plane upgrade applied"
else
  ensure_k3s_started
  wait_for_kubernetes_api
  import_control_plane_images
  apply_local_storage
  apply_control_plane
  report_handoff
fi
