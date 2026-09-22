#!/usr/bin/env bash
set -euo pipefail

# Own the cluster resolver configuration so customer DHCP search domains can
# never reach appliance pods.
#
# k3s passes this file to kubelet via `--resolv-conf`, and kubelet only copies
# `nameserver` lines (plus Kubernetes service search suffixes) into each pod's
# /etc/resolv.conf. Writing a search-free upstream resolver therefore removes
# the customer search suffix from every new pod — including third-party
# controllers such as Flux — without relying on manifest-level dnsConfig.
#
# This one implementation owns resolver selection, validation, file generation,
# change detection and activation. It runs on the host at bootstrap and via the
# control-plane reconciliation Job on existing installs.

ROOT_PREFIX="${ALGA_APPLIANCE_DNS_ROOT:-}"
SETUP_INPUTS_FILE="${ALGA_APPLIANCE_SETUP_INPUTS_FILE:-/var/lib/alga-appliance/setup-inputs.json}"
SYSTEMD_RESOLV_CONF="${ALGA_APPLIANCE_SYSTEM_RESOLV_CONF:-/run/systemd/resolve/resolv.conf}"
HOST_RESOLV_CONF="${ALGA_APPLIANCE_HOST_RESOLV_CONF:-/etc/resolv.conf}"
K3S_RESOLV_CONF="${ALGA_APPLIANCE_K3S_RESOLV_CONF:-/etc/rancher/k3s/resolv.conf}"
K3S_DNS_DROPIN="${ALGA_APPLIANCE_K3S_DNS_DROPIN:-/etc/rancher/k3s/config.yaml.d/30-alga-dns.yaml}"
DNS_ACTIVATION_FILE="${ALGA_APPLIANCE_DNS_ACTIVATION_FILE:-/var/lib/alga-appliance/dns-activation.json}"
DNS_PENDING_FILE="${ALGA_APPLIANCE_DNS_PENDING_FILE:-/var/lib/alga-appliance/dns-activation-pending.json}"
DNS_LOCK_PATH="${ALGA_APPLIANCE_DNS_LOCK_PATH:-/var/lib/alga-appliance/dns-reconcile.lock}"
K3S_SERVICE="${ALGA_APPLIANCE_K3S_SERVICE:-k3s}"
KUBECTL_BIN="${ALGA_APPLIANCE_KUBECTL:-kubectl}"
KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
DNS_API_TIMEOUT_SECONDS="${ALGA_APPLIANCE_DNS_API_TIMEOUT_SECONDS:-300}"
DNS_LOCK_ATTEMPTS="${ALGA_APPLIANCE_DNS_LOCK_ATTEMPTS:-150}"
DNS_RESTART_COMMAND="${ALGA_APPLIANCE_DNS_RESTART_COMMAND:-}"
DRY_RUN=false
ACTIVATE_OVERRIDE=""
INITIAL_MODE=false

usage() {
  cat <<'EOF'
Usage: configure-k3s-dns.sh [options]

Options:
  --root <path>        Prefix host paths (tests / staged roots). Default: ""
  --host-root <path>   Alias for --root (Job mount)
  --initial            First boot: write files and record activation (k3s has not
                       started yet; no restart)
  --activate           Perform k3s restart and workload rollout after writing
  --no-activate        Write the files only (no restart)
  --dry-run            Print planned actions without mutating anything
  --help               Show this help

The default with no mode flag is to write the files and activate only when the
content changed or a prior activation is still pending. Activation is resumable:
a pending record is persisted before k3s is restarted, so a process killed by
the restart resumes the rollout instead of restarting k3s again.
EOF
}

log() { printf '%s\n' "$*"; }
plan() { printf 'PLAN: %s\n' "$*"; }

# All host paths are rooted so tests can operate on a temporary tree.
rooted() { printf '%s%s' "$ROOT_PREFIX" "$1"; }
rp() { printf '%s%s' "$ROOT_PREFIX" "$1"; }

read_setup_dns() {
  local file
  file="$(rooted "$SETUP_INPUTS_FILE")"
  DNS_MODE="system"
  DNS_SERVERS=""
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    return 0
  fi
  # JSON parser only — never shell-evaluate operator input.
  local parsed
  parsed="$(node -e '
    const fs = require("fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const mode = typeof value.dnsMode === "string" ? value.dnsMode : "system";
      const servers = typeof value.dnsServers === "string" ? value.dnsServers : "";
      process.stdout.write(`${mode}\n${servers}`);
    } catch {
      process.stdout.write("system\n");
    }
  ' "$file" 2>/dev/null || printf 'system\n')"
  DNS_MODE="$(printf '%s' "$parsed" | sed -n '1p')"
  DNS_SERVERS="$(printf '%s' "$parsed" | sed -n '2p')"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

is_ipv4() {
  local value="$1"
  [[ "$value" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local octet
  for octet in "${BASH_REMATCH[@]:1:4}"; do
    [ "$((10#$octet))" -le 255 ] || return 1
  done
}

is_ipv6() {
  local value="$1"
  [[ "$value" == *:* ]] || return 1
  [[ "$value" =~ ^[0-9A-Fa-f:]+$ ]] || return 1
}

is_usable_resolver() {
  local value="$1"
  [ -n "$value" ] || return 1
  if is_ipv4 "$value"; then
    [[ "$value" == 127.* ]] && return 1
    [[ "$value" == 0.0.0.0 ]] && return 1
    return 0
  fi
  if is_ipv6 "$value"; then
    case "${value,,}" in
      "::1"|"::") return 1 ;;
    esac
    return 0
  fi
  return 1
}

# Prints candidate nameservers (one per line) from a resolv.conf-shaped file.
nameservers_from() {
  local file="$1"
  [ -f "$file" ] || return 0
  awk '/^[[:space:]]*nameserver[[:space:]]+/ { print $2 }' "$file"
}

gather_resolvers() {
  local candidates=()
  if [ "$DNS_MODE" = "custom" ]; then
    local raw
    while IFS= read -r raw || [ -n "$raw" ]; do
      candidates+=("$(trim "$raw")")
    done < <(printf '%s\n' "$DNS_SERVERS" | tr ',' '\n')
  else
    local systemd_file host_file
    systemd_file="$(rooted "$SYSTEMD_RESOLV_CONF")"
    host_file="$(rooted "$HOST_RESOLV_CONF")"
    while IFS= read -r raw || [ -n "$raw" ]; do
      candidates+=("$(trim "$raw")")
    done < <(nameservers_from "$systemd_file")
    if [ "${#candidates[@]}" -eq 0 ]; then
      while IFS= read -r raw || [ -n "$raw" ]; do
        candidates+=("$(trim "$raw")")
      done < <(nameservers_from "$host_file")
    fi
  fi

  RESOLVERS=()
  local candidate existing seen
  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    if ! is_usable_resolver "$candidate"; then
      if [ "$DNS_MODE" = "custom" ]; then
        echo "DNS configuration failure: custom DNS server '$candidate' is not a usable literal address." >&2
        return 1
      fi
      continue
    fi
    seen=false
    for existing in "${RESOLVERS[@]:-}"; do
      if [ "$existing" = "$candidate" ]; then
        seen=true
        break
      fi
    done
    $seen || RESOLVERS+=("$candidate")
  done

  if [ "${#RESOLVERS[@]}" -eq 0 ]; then
    echo "DNS configuration failure: no usable upstream resolver was found (mode=$DNS_MODE). Refusing to write an empty resolver file." >&2
    return 1
  fi
}

render_files() {
  DESIRED_RESOLV=""
  local resolver
  for resolver in "${RESOLVERS[@]}"; do
    DESIRED_RESOLV+="nameserver ${resolver}"$'\n'
  done
  DESIRED_DROPIN='resolv-conf: /etc/rancher/k3s/resolv.conf'$'\n'
  DESIRED_FINGERPRINT="$(printf '%s' "$DESIRED_RESOLV" | sha256sum | awk '{print $1}')"
}

file_matches() {
  local file="$1"
  local desired="$2"
  [ -f "$file" ] || return 1
  # Command substitution strips the trailing newline on both sides, so equal
  # logical content compares equal regardless of the final newline.
  [ "$(cat "$file")" = "$(printf '%s' "$desired")" ]
}

activation_is_current() {
  local file
  file="$(rooted "$DNS_ACTIVATION_FILE")"
  [ -f "$file" ] || return 1
  local recorded
  recorded="$(node -e '
    const fs = require("fs");
    try { process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).fingerprint || "")); }
    catch { process.stdout.write(""); }
  ' "$file" 2>/dev/null || true)"
  [ "$recorded" = "$DESIRED_FINGERPRINT" ]
}

# A pending record means a prior invocation wrote the files and was about to
# restart k3s (or was killed by that restart). Its presence for the current
# fingerprint is what makes activation resumable without a second restart.
pending_is_current() {
  local file
  file="$(rooted "$DNS_PENDING_FILE")"
  [ -f "$file" ] || return 1
  local recorded
  recorded="$(node -e '
    const fs = require("fs");
    try { process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).fingerprint || "")); }
    catch { process.stdout.write(""); }
  ' "$file" 2>/dev/null || true)"
  [ "$recorded" = "$DESIRED_FINGERPRINT" ]
}

write_file_atomic() {
  local target="$1"
  local content="$2"
  local dir
  dir="$(dirname "$target")"
  mkdir -p "$dir"
  local tmp="${target}.tmp.$$"
  printf '%s' "$content" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$target"
}

write_files() {
  write_file_atomic "$(rooted "$K3S_RESOLV_CONF")" "$DESIRED_RESOLV"
  write_file_atomic "$(rooted "$K3S_DNS_DROPIN")" "$DESIRED_DROPIN"
}

write_record() {
  local file="$1"
  local stage="$2"
  local target
  target="$(rooted "$file")"
  mkdir -p "$(dirname "$target")"
  local tmp="${target}.tmp.$$"
  node -e '
    const fs = require("fs");
    const target = process.argv[1];
    const payload = {
      fingerprint: process.argv[2],
      stage: process.argv[3],
      resolvers: process.argv[4].split("\n").filter(Boolean),
      recordedAt: process.argv[5],
      files: { resolver: process.argv[6], dropin: process.argv[7] }
    };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  ' "$tmp" "$DESIRED_FINGERPRINT" "$stage" "$DESIRED_RESOLV" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$K3S_RESOLV_CONF" "$K3S_DNS_DROPIN"
  mv -f "$tmp" "$target"
}

record_activation() {
  write_record "$DNS_ACTIVATION_FILE" "active"
}

record_pending() {
  write_record "$DNS_PENDING_FILE" "restart-requested"
}

acquire_lock() {
  if $DRY_RUN; then
    return 0
  fi
  mkdir -p "$(dirname "$(rooted "$DNS_LOCK_PATH")")"
  local lock
  lock="$(rooted "$DNS_LOCK_PATH")"
  local attempts=0
  while :; do
    if [ -d "$lock" ]; then
      rmdir "$lock" 2>/dev/null || true
    fi
    if ln -s "$$" "$lock" 2>/dev/null; then
      break
    fi
    local owner
    owner="$(readlink "$lock" 2>/dev/null || true)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$lock" 2>/dev/null || true
      continue
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$DNS_LOCK_ATTEMPTS" ]; then
      echo "Timed out waiting for another DNS reconciliation to finish." >&2
      exit 1
    fi
    sleep 2
  done
  DNS_LOCK_FILE="$lock"
  trap 'rm -f "$DNS_LOCK_FILE" 2>/dev/null || true' EXIT INT TERM
}

restart_k3s() {
  if [ -n "$DNS_RESTART_COMMAND" ]; then
    bash -c "$DNS_RESTART_COMMAND"
    return
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart "$K3S_SERVICE"
    return
  fi
  echo "No systemctl available to restart k3s; skipping restart." >&2
}

wait_for_api() {
  local deadline=$((SECONDS + DNS_API_TIMEOUT_SECONDS))
  while :; do
    if "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" get --raw=/readyz >/dev/null 2>&1; then
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "Timed out waiting for the Kubernetes API after ${DNS_API_TIMEOUT_SECONDS}s." >&2
      return 1
    fi
    sleep 3
  done
}

rollout_restart() {
  local namespace="$1" kind="$2" name="$3"
  if ! "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get "$kind" "$name" >/dev/null 2>&1; then
    log "Skipping absent ${kind}/${name} in ${namespace}."
    return 0
  fi
  "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" rollout restart "$kind/$name"
}

# Ordered rollout: CoreDNS first (so new pods can resolve), then storage
# provisioner and Flux controllers (third-party controllers included), then
# appliance application controllers, control plane last. StatefulSets and
# DaemonSets are restarted through the same kubectl rollout path.
default_restart_targets() {
  cat <<'EOF'
kube-system daemonset coredns
kube-system deployment coredns
local-path-storage deployment local-path-provisioner
flux-system deployment source-controller
flux-system deployment kustomize-controller
flux-system deployment helm-controller
flux-system deployment notification-controller
alga-system deployment alga-core
alga-system statefulset postgresql
alga-system statefulset redis
alga-appliance-control-plane deployment appliance-control-plane
EOF
}

rollout_existing_pods() {
  local targets
  targets="${ALGA_APPLIANCE_DNS_RESTART_TARGETS:-$(default_restart_targets)}"
  local line namespace kind name
  while IFS= read -r line; do
    [ -n "$(trim "$line")" ] || continue
    namespace="$(printf '%s' "$line" | awk '{print $1}')"
    kind="$(printf '%s' "$line" | awk '{print $2}')"
    name="$(printf '%s' "$line" | awk '{print $3}')"
    rollout_restart "$namespace" "$kind" "$name"
  done <<< "$targets"
  log "Existing standalone pods and completed Jobs are not recreated by this helper."
}

# Activation is resumable: when no pending record exists we persist one BEFORE
# restarting k3s, so a process killed by the restart resumes at the rollout step
# on the next invocation instead of restarting k3s again (which without the
# pending record would loop forever).
activate() {
  if pending_is_current; then
    log "Resuming a pending DNS activation; k3s was already restarted for fingerprint ${DESIRED_FINGERPRINT:0:12}."
  else
    record_pending
    log "DNS configuration changed; restarting k3s once and recreating affected pods."
    restart_k3s
  fi
  wait_for_api || return 1
  rollout_existing_pods
  record_activation
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root|--host-root)
      ROOT_PREFIX="$2"
      shift 2
      ;;
    --initial)
      INITIAL_MODE=true
      ACTIVATE_OVERRIDE="false"
      shift
      ;;
    --activate)
      ACTIVATE_OVERRIDE="true"
      shift
      ;;
    --no-activate)
      ACTIVATE_OVERRIDE="false"
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

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to parse setup inputs safely." >&2
  exit 1
fi

read_setup_dns
gather_resolvers
render_files

RESOLV_TARGET="$(rooted "$K3S_RESOLV_CONF")"
DROPIN_TARGET="$(rooted "$K3S_DNS_DROPIN")"

resolv_current=false
dropin_current=false
file_matches "$RESOLV_TARGET" "$DESIRED_RESOLV" && resolv_current=true
file_matches "$DROPIN_TARGET" "$DESIRED_DROPIN" && dropin_current=true

if $DRY_RUN; then
  plan "write ${K3S_RESOLV_CONF} (${#RESOLVERS[@]} nameserver lines, no search domains)"
  plan "write ${K3S_DNS_DROPIN} (resolv-conf: ${K3S_RESOLV_CONF})"
  if $INITIAL_MODE; then
    plan "record activation for the imminent k3s start (no restart)"
  elif $resolv_current && $dropin_current && activation_is_current; then
    plan "no change; k3s restart skipped"
  elif pending_is_current; then
    plan "resume a pending activation; recreate pods without another k3s restart"
  else
    plan "restart k3s and recreate: CoreDNS, provisioner, Flux, appliance, control plane"
  fi
  exit 0
fi

acquire_lock

content_changed=false
if ! $resolv_current || ! $dropin_current; then
  content_changed=true
fi

if $content_changed; then
  write_files
  log "Wrote ${K3S_RESOLV_CONF} with ${#RESOLVERS[@]} nameserver(s) and no search domains."
else
  log "DNS resolver files already match the desired configuration."
fi

# First boot: k3s has not started yet, so it will read these files on the way up.
# Record activation now so the first running reconcile does not restart k3s just
# to re-apply a configuration every fresh pod already received.
if $INITIAL_MODE; then
  record_activation
  log "Recorded DNS activation for the imminent k3s start."
  exit 0
fi

if [ "$ACTIVATE_OVERRIDE" = "false" ]; then
  log "Activation skipped (--no-activate)."
  exit 0
fi

if activation_is_current; then
  log "DNS configuration already active for fingerprint ${DESIRED_FINGERPRINT:0:12}; no restart."
else
  activate
fi
