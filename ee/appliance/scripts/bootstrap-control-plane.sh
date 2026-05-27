#!/usr/bin/env bash
set -euo pipefail

APPLIANCE_ROOT="${ALGA_APPLIANCE_ROOT:-/opt/alga-appliance}"
KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
SETUP_PORT="${ALGA_APPLIANCE_PORT:-8080}"
TOKEN_FILE="${ALGA_APPLIANCE_TOKEN_FILE:-/var/lib/alga-appliance/setup-token}"
K3S_READY_TIMEOUT_SECONDS="${ALGA_K3S_READY_TIMEOUT_SECONDS:-180}"
DRY_RUN=false

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
  if [ "$DRY_RUN" = "true" ]; then
    plan "kubectl --kubeconfig $KUBECONFIG_PATH -n $CONTROL_PLANE_NAMESPACE create secret generic appliance-setup-token --from-file=setup-token=$TOKEN_FILE --dry-run=client -o yaml | kubectl --kubeconfig $KUBECONFIG_PATH apply -f -"
  else
    log "creating/updating appliance setup token Secret"
    kubectl_cmd -n "$CONTROL_PLANE_NAMESPACE" create secret generic appliance-setup-token --from-file=setup-token="$TOKEN_FILE" --dry-run=client -o yaml | kubectl_cmd apply -f - >/dev/null
  fi
  if [ "$DRY_RUN" = "true" ]; then
    plan "kubectl --kubeconfig $KUBECONFIG_PATH apply -k $CONTROL_PLANE_MANIFESTS"
  else
    log "kubectl apply -k $CONTROL_PLANE_MANIFESTS"
    kubectl_cmd apply -k "$CONTROL_PLANE_MANIFESTS"
  fi
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
  3. setup handoff: http://$ip:$SETUP_PORT/setup?token=$token

Setup token: $token
Fallback recovery: sudo $FALLBACK_COMMAND
Logs: sudo journalctl -u alga-appliance-bootstrap.service -u k3s -f
EOF
}

ensure_k3s_started
wait_for_kubernetes_api
import_control_plane_images
apply_local_storage
apply_control_plane
report_handoff
