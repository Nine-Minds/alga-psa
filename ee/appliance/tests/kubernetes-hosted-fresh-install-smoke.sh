#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  kubernetes-hosted-fresh-install-smoke.sh preflight --overlay-root <path>
  kubernetes-hosted-fresh-install-smoke.sh verify --node-ip <ip> --token <token> --kubeconfig <path>

Preflight validates that a built ISO overlay contains the offline control-plane
assets needed before any registry/GitHub dependency.

Verify runs after booting a fresh ISO VM. It checks that the Kubernetes-hosted
setup UI/status API are reachable, the control-plane namespace is independent,
setup can be submitted, login-ready status is reached, and fallback reapply is
safe to run.
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

preflight() {
  local overlay_root=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --overlay-root) overlay_root="$2"; shift 2 ;;
      *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
    esac
  done

  [ -n "$overlay_root" ] || { echo "--overlay-root is required" >&2; exit 2; }
  test -f "$overlay_root/opt/alga-appliance/control-plane/bundle.json"
  test -f "$overlay_root/opt/alga-appliance/control-plane/manifests/kustomization.yaml"
  test -f "$overlay_root/opt/alga-appliance/control-plane/manifests/workload.yaml"
  test -f "$overlay_root/opt/alga-appliance/manifests/local-path-storage.yaml"
  test -x "$overlay_root/opt/alga-appliance/bin/alga-control-plane-reapply"
  test -x "$overlay_root/opt/alga-appliance/bin/k3s"
  test -x "$overlay_root/opt/alga-appliance/scripts/bootstrap-control-plane.sh"
  test -x "$overlay_root/opt/alga-appliance/scripts/install-storage.sh"
  test -f "$overlay_root/etc/systemd/system/alga-appliance-bootstrap.service"
  test -f "$overlay_root/etc/systemd/system/alga-host-agent.service"
  test -f "$overlay_root/etc/sysusers.d/alga-appliance.conf"
  grep -q 'After=local-fs.target cloud-final.service' "$overlay_root/etc/systemd/system/alga-appliance-console.service"
  grep -q 'ALGA_APPLIANCE_CONSOLE_TTYS=/dev/tty1,/dev/console' "$overlay_root/etc/systemd/system/alga-appliance-console.service"
  grep -q 'StandardOutput=journal' "$overlay_root/etc/systemd/system/alga-appliance-console.service"
  ! grep -q 'network-online.target' "$overlay_root/etc/systemd/system/alga-appliance-console.service"
  ! grep -q 'TTYReset=' "$overlay_root/etc/systemd/system/alga-appliance-console.service"
  ! grep -q 'TTYPath=' "$overlay_root/etc/systemd/system/alga-appliance-console.service"
  ! grep -q 'ExecStartPre=/usr/bin/env node /opt/alga-appliance/host-service/console.mjs' "$overlay_root/etc/systemd/system/alga-appliance-bootstrap.service"
  grep -q 'ExecStartPost=/usr/bin/env node /opt/alga-appliance/host-service/console.mjs' "$overlay_root/etc/systemd/system/alga-appliance-bootstrap.service"
  test -L "$overlay_root/etc/systemd/system/multi-user.target.wants/alga-appliance-bootstrap.service"
  test -L "$overlay_root/etc/systemd/system/multi-user.target.wants/alga-host-agent.service"
  test -L "$overlay_root/etc/systemd/system/alga-appliance.service"
  compgen -G "$overlay_root/opt/alga-appliance/control-plane/images/*.tar" >/dev/null
  echo "PASS: ISO overlay contains Kubernetes-hosted control-plane bootstrap assets"
}

http_code() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' "$url" || true
}

verify() {
  local node_ip=""
  local token=""
  local kubeconfig=""
  local timeout_seconds=3600

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --node-ip) node_ip="$2"; shift 2 ;;
      --token) token="$2"; shift 2 ;;
      --kubeconfig) kubeconfig="$2"; shift 2 ;;
      --timeout-seconds) timeout_seconds="$2"; shift 2 ;;
      *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
    esac
  done

  [ -n "$node_ip" ] || { echo "--node-ip is required" >&2; exit 2; }
  [ -n "$token" ] || { echo "--token is required" >&2; exit 2; }
  [ -n "$kubeconfig" ] || { echo "--kubeconfig is required" >&2; exit 2; }
  require_cmd curl
  require_cmd kubectl
  require_cmd jq

  local kube=(kubectl --kubeconfig "$kubeconfig")
  local base="http://${node_ip}:8080"
  local health_url="${base}/healthz"
  local setup_api_url="${base}/api/setup"
  local status_url="${base}/api/status"
  local cookie_jar; cookie_jar="$(mktemp)"
  local mgmt_password="Str0ng!Pass"
  local deadline=$((SECONDS + timeout_seconds))

  # Readiness: /healthz is open (no session required).
  until [ "$(http_code "$health_url")" = "200" ]; do
    [ "$SECONDS" -lt "$deadline" ] || { echo "setup UI did not become reachable" >&2; exit 1; }
    sleep 5
  done

  "${kube[@]}" -n alga-appliance-control-plane get deploy appliance-control-plane
  "${kube[@]}" -n alga-appliance-control-plane get svc appliance-control-plane
  "${kube[@]}" -n msp get deploy >/dev/null 2>&1 || true

  # Authenticate: redeem the one-time setup token, then set the management
  # password. The session cookie is stored in the jar and reused below.
  curl -fsS -c "$cookie_jar" -X POST "${base}/api/auth/redeem-token" \
    -H 'content-type: application/json' \
    --data '{"token":"'"$token"'"}' >/dev/null
  curl -fsS -c "$cookie_jar" -b "$cookie_jar" -X POST "${base}/api/auth/set-password" \
    -H 'content-type: application/json' \
    --data '{"token":"'"$token"'","password":"'"$mgmt_password"'"}' >/dev/null

  curl -fsS -b "$cookie_jar" -X POST "$setup_api_url" \
    -H 'content-type: application/json' \
    --data '{"channel":"stable","appHostname":"http://'"$node_ip"':3000","dnsMode":"system","tenantName":"Acme MSP","adminFirstName":"Ava","adminLastName":"Admin","adminEmail":"ava@example.com","adminPassword":"Str0ng!Pass","adminPasswordConfirm":"Str0ng!Pass"}' >/dev/null

  until curl -fsS -b "$cookie_jar" "$status_url" | jq -e '.rollup.state == "ready_to_log_in" or .rollup.state == "ready_with_background_issues"' >/dev/null; do
    [ "$SECONDS" -lt "$deadline" ] || { echo "login-ready status was not reached" >&2; exit 1; }
    sleep 10
  done

  "${kube[@]}" -n msp get secret appliance-initial-tenant
  ssh "root@${node_ip}" /opt/alga-appliance/bin/alga-control-plane-reapply
  curl -fsS -b "$cookie_jar" "$status_url" >/dev/null
  echo "PASS: fresh ISO install reached Kubernetes-hosted setup and login-ready status"
}

case "${1:-}" in
  preflight) shift; preflight "$@" ;;
  verify) shift; verify "$@" ;;
  -h|--help) usage ;;
  *) usage; exit 2 ;;
esac
