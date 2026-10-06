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
# change detection, activation and the durable activation record. It runs on the
# host (bootstrap and the host-owned activation service) and, for write-only
# reconciliation, inside the control-plane Job with a rooted host mount.
#
# Activation is staged in <status-file>:
#   restarting -> restart-confirmed -> rolling-out -> active
#                                            \-> failed
# A prior stage for the current fingerprint is only resumed when the k3s start
# token proves the restart actually happened, so a failed restart can never be
# mistaken for a completed activation. A failed rollout also already restarted
# k3s, so resuming skips the restart and only re-verifies the rollout.

ROOT_PREFIX="${ALGA_APPLIANCE_DNS_ROOT:-}"
SETUP_INPUTS_FILE="${ALGA_APPLIANCE_SETUP_INPUTS_FILE:-/var/lib/alga-appliance/setup-inputs.json}"
SYSTEMD_RESOLV_CONF="${ALGA_APPLIANCE_SYSTEM_RESOLV_CONF:-/run/systemd/resolve/resolv.conf}"
HOST_RESOLV_CONF="${ALGA_APPLIANCE_HOST_RESOLV_CONF:-/etc/resolv.conf}"
K3S_RESOLV_CONF="${ALGA_APPLIANCE_K3S_RESOLV_CONF:-/etc/rancher/k3s/resolv.conf}"
K3S_DNS_DROPIN="${ALGA_APPLIANCE_K3S_DNS_DROPIN:-/etc/rancher/k3s/config.yaml.d/30-alga-dns.yaml}"
DNS_STATUS_FILE="${ALGA_APPLIANCE_DNS_STATUS_FILE:-/var/lib/alga-appliance/dns-activation.json}"
DNS_LOCK_PATH="${ALGA_APPLIANCE_DNS_LOCK_PATH:-/var/lib/alga-appliance/dns-reconcile.lock}"
# Requested configuration fingerprint supplied by the control-plane submission.
# When set, the persisted setup inputs must resolve to the same fingerprint or
# the activation is refused: a submission must never label a different
# configuration as its own.
DNS_CONFIG_FINGERPRINT_EXPECTED="${ALGA_APPLIANCE_DNS_CONFIG_FINGERPRINT:-}"
K3S_SERVICE="${ALGA_APPLIANCE_K3S_SERVICE:-k3s}"
KUBECTL_BIN="${ALGA_APPLIANCE_KUBECTL:-kubectl}"
KUBECONFIG_PATH="${ALGA_APPLIANCE_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
DNS_API_TIMEOUT_SECONDS="${ALGA_APPLIANCE_DNS_API_TIMEOUT_SECONDS:-300}"
DNS_ROLLOUT_TIMEOUT_SECONDS="${ALGA_APPLIANCE_DNS_ROLLOUT_TIMEOUT_SECONDS:-300}"
DNS_LOCK_ATTEMPTS="${ALGA_APPLIANCE_DNS_LOCK_ATTEMPTS:-150}"
DNS_RESTART_COMMAND="${ALGA_APPLIANCE_DNS_RESTART_COMMAND:-}"
DNS_K3S_ACTIVE_COMMAND="${ALGA_APPLIANCE_DNS_K3S_ACTIVE_COMMAND:-systemctl is-active --quiet ${K3S_SERVICE}}"
DNS_K3S_START_COMMAND="${ALGA_APPLIANCE_DNS_K3S_START_COMMAND:-systemctl show -p ActiveEnterTimestamp --value ${K3S_SERVICE}}"
# Ordered namespace groups: CoreDNS/kube-system first, then storage + Flux, then
# the application plane, then the control plane last. Every Deployment,
# StatefulSet and DaemonSet in each group is restarted and verified.
DNS_NAMESPACE_GROUPS="${ALGA_APPLIANCE_DNS_NAMESPACE_GROUPS:-kube-system local-path-storage flux-system msp alga-system alga-appliance-control-plane}"
DRY_RUN=false
ACTIVATE_OVERRIDE=""
INITIAL_MODE=false
# Fingerprint of the configuration these files and the activation record describe.
# Derived from the persisted setup inputs just like the control plane's
# dns-config.mjs, so admission can compare the two without trusting timestamps.
CONFIG_FINGERPRINT=""

usage() {
  cat <<'EOF'
Usage: configure-k3s-dns.sh [options]

Options:
  --root <path>        Prefix host paths (tests / staged roots). Default: ""
  --host-root <path>   Alias for --root (Job mount)
  --initial            First boot only: write files and record activation when
                       k3s has not started yet (otherwise falls back to activate)
  --activate           Write files, restart k3s if needed, roll out and record
  --no-activate        Write the files only (no restart, no activation record)
  --dry-run            Print planned actions without mutating anything
  --help               Show this help

The default with no mode flag activates only when the content changed or a prior
activation is still pending/verified incomplete.
EOF
}

log() { printf '%s\n' "$*"; }
plan() { printf 'PLAN: %s\n' "$*"; }

rooted() { printf '%s%s' "$ROOT_PREFIX" "$1"; }

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

# Parse setup inputs with a JSON parser, never shell evaluation. Invalid JSON is
# a visible failure: silently falling back to system DNS could hide a typo.
read_setup_dns() {
  local file
  file="$(rooted "$SETUP_INPUTS_FILE")"
  DNS_MODE="system"
  DNS_SERVERS=""
  if [ -z "$file" ] || [ ! -f "$file" ]; then
    return 0
  fi
  local parsed
  if ! parsed="$(node -e '
    const fs = require("fs");
    let value;
    try {
      value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    } catch (error) {
      process.stderr.write(`setup inputs are not valid JSON: ${error.message}\n`);
      process.exit(2);
    }
    const mode = typeof value.dnsMode === "string" ? value.dnsMode : "system";
    let servers = value.dnsServers;
    if (Array.isArray(servers)) servers = servers.join(",");
    servers = typeof servers === "string" ? servers : "";
    process.stdout.write(`${mode}\n${servers}`);
  ' "$file" 2>&1)"; then
    printf '%s\n' "$parsed" >&2
    return 1
  fi
  DNS_MODE="$(printf '%s' "$parsed" | sed -n '1p')"
  DNS_SERVERS="$(printf '%s' "$parsed" | sed -n '2p')"
  case "$DNS_MODE" in
    system|custom) ;;
    *) DNS_MODE="system" ;;
  esac
}

# Identity of the requested resolver configuration, derived from the same setup
# inputs the file generation reads. Must byte-match
# host-service/dns-config.mjs#dnsConfigurationFingerprint so setup admission can
# compare the host's activation against the control plane's expectation.
setup_inputs_config_fingerprint() {
  local file
  file="$(rooted "$SETUP_INPUTS_FILE")"
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    let value = {};
    try { value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")) || {}; } catch { value = {}; }
    const mode = String(value.dnsMode || "system").trim().toLowerCase() === "custom" ? "custom" : "system";
    let raw = value.dnsServers;
    if (Array.isArray(raw)) raw = raw.join(",");
    const servers = mode === "custom"
      ? String(raw || "").split(",").map((entry) => entry.trim()).filter(Boolean)
      : [];
    process.stdout.write(crypto.createHash("sha256").update(`${mode}\n${servers.join("\n")}`).digest("hex"));
  ' "$file" 2>/dev/null || true
}

# Validate candidate resolvers with Node's IP parser and normalize IPv6 so
# equivalent loopback spellings (127.0.0.53, ::1, 0:0:0:0:0:0:0:1,
# ::ffff:127.0.0.1) are all rejected. Prints "OK <canonical>" / "BAD <raw>".
validate_candidates() {
  local mode="$1"
  VALIDATED_RESOLVERS=()
  INVALID_CANDIDATES=()
  local results
  if ! results="$(VALIDATE_MODE="$mode" node -e '
    const fs = require("fs");
    const net = require("net");
    const raw = fs.readFileSync(0, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
    const canonical = (ip) => {
      const version = net.isIP(ip);
      if (version === 0) return null;
      if (version === 4) return ip;
      try {
        return new URL(`http://[${ip}]/`).hostname.replace(/^\[|\]$/g, "");
      } catch {
        return null;
      }
    };
    const unusable = (value) => {
      if (!value) return true;
      if (value === "0.0.0.0" || value === "::" || value === "::1") return true;
      if (/^127\./.test(value)) return true;
      if (/^::ffff:127\./i.test(value)) return true;
      return false;
    };
    const seen = new Set();
    for (const candidate of raw) {
      const value = canonical(candidate);
      if (!value || unusable(value)) {
        process.stdout.write(`BAD ${candidate}\n`);
        continue;
      }
      if (seen.has(value)) continue;
      seen.add(value);
      process.stdout.write(`OK ${value}\n`);
    }
  ')" 2>/dev/null; then
    if [ "$mode" = "custom" ]; then
      printf 'DNS configuration failure: could not validate the configured DNS servers.\n' >&2
      return 1
    fi
    return 0
  fi
  local line
  while IFS= read -r line; do
    case "$line" in
      OK\ *) VALIDATED_RESOLVERS+=("${line#OK }") ;;
      BAD\ *) INVALID_CANDIDATES+=("${line#BAD }") ;;
    esac
  done <<< "$results"
}

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

  validate_candidates "$DNS_MODE" < <(printf '%s\n' "${candidates[@]:-}")
  if [ "$DNS_MODE" = "custom" ] && [ "${#INVALID_CANDIDATES[@]}" -gt 0 ]; then
    local bad
    for bad in "${INVALID_CANDIDATES[@]}"; do
      printf "DNS configuration failure: custom DNS server '%s' is not a usable literal address.\n" "$bad" >&2
    done
    return 1
  fi
  if [ "${#VALIDATED_RESOLVERS[@]}" -eq 0 ]; then
    printf 'DNS configuration failure: no usable upstream resolver was found (mode=%s). Refusing to write an empty resolver file.\n' "$DNS_MODE" >&2
    return 1
  fi
  RESOLVERS=("${VALIDATED_RESOLVERS[@]}")
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
  [ "$(cat "$file")" = "$(printf '%s' "$desired")" ]
}

write_file_atomic() {
  local target="$1"
  local content="$2"
  mkdir -p "$(dirname "$target")"
  local tmp="${target}.tmp.$$"
  printf '%s' "$content" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$target"
}

write_files() {
  write_file_atomic "$(rooted "$K3S_RESOLV_CONF")" "$DESIRED_RESOLV"
  write_file_atomic "$(rooted "$K3S_DNS_DROPIN")" "$DESIRED_DROPIN"
}

# Durable activation record. Every stage write preserves the original start time
# and accumulates the evidence ({stage, fingerprint, resolvers, restartFrom,
# restartVerified, error, timestamps}) so the control plane can read the true
# state from the shared hostPath. Written 0644 (addresses only, no secrets) so the
# control-plane host-service running as UID 10001 can read it from the state
# volume; a root-only 0600 file would be invisible to it.
write_status() {
  local stage="$1"
  local error="${2:-}"
  local target
  target="$(rooted "$DNS_STATUS_FILE")"
  mkdir -p "$(dirname "$target")"
  local tmp="${target}.tmp.$$"
  STATUS_PREVIOUS_FILE="$target" \
  STATUS_STAGE="$stage" \
  STATUS_ERROR="$error" \
  STATUS_FINGERPRINT="${DESIRED_FINGERPRINT:-}" \
  STATUS_CONFIG_FINGERPRINT="${CONFIG_FINGERPRINT:-}" \
  STATUS_RESOLVERS="${DESIRED_RESOLV:-}" \
  STATUS_RESTART_FROM="${RESTART_FROM:-}" \
  STATUS_RESTART_TOKEN="${RESTART_TOKEN:-}" \
  STATUS_FILES_RESOLV="$K3S_RESOLV_CONF" \
  STATUS_FILES_DROPIN="$K3S_DNS_DROPIN" \
  node -e '
    const fs = require("fs");
    const output = process.argv[1];
    // Read the durable record, NOT the about-to-be-written temp file, so
    // restartFrom/startedAt evidence survives every atomic rewrite and a
    // resumed activation does not lose its proof that the restart happened.
    const previousFile = process.env.STATUS_PREVIOUS_FILE;
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(previousFile, "utf8")) || {}; } catch { /* first write */ }
    const now = new Date().toISOString();
    const fingerprint = process.env.STATUS_FINGERPRINT || null;
    // Restart evidence belongs to the resolver bytes that were restarted.
    // A failed submission for new bytes must not inherit the old token and
    // trick a later reconcile into skipping the required k3s restart.
    const sameFingerprint = Boolean(fingerprint) && fingerprint === previous.fingerprint;
    const payload = {
      stage: process.env.STATUS_STAGE,
      fingerprint,
      configFingerprint: process.env.STATUS_CONFIG_FINGERPRINT || (sameFingerprint ? previous.configFingerprint : null) || null,
      resolvers: (process.env.STATUS_RESOLVERS || "").split("\n").filter(Boolean),
      restartFrom: process.env.STATUS_RESTART_FROM || (sameFingerprint ? previous.restartFrom : null) || null,
      restartToken: process.env.STATUS_RESTART_TOKEN || (sameFingerprint ? previous.restartToken : null) || null,
      error: process.env.STATUS_ERROR || null,
      files: { resolver: process.env.STATUS_FILES_RESOLV, dropin: process.env.STATUS_FILES_DROPIN },
      startedAt: (sameFingerprint && previous.startedAt) || now,
      updatedAt: now,
      finishedAt: ["active", "failed"].includes(process.env.STATUS_STAGE) ? now : null
    };
    fs.writeFileSync(output, JSON.stringify(payload, null, 2) + "\n", { mode: 0o644 });
    // The process umask can mask the create mode; force world-read so UID 10001
    // can read it regardless of the host umask.
    fs.chmodSync(output, 0o644);
  ' "$tmp"
  mv -f "$tmp" "$target"
}

status_field() {
  local field="$1"
  local target
  target="$(rooted "$DNS_STATUS_FILE")"
  [ -f "$target" ] || return 0
  node -e '
    const fs = require("fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(value?.[process.argv[2]] ?? ""));
    } catch { process.stdout.write(""); }
  ' "$target" "$field" 2>/dev/null || true
}

activation_is_active() {
  [ "$(status_field stage)" = "active" ] && [ "$(status_field fingerprint)" = "$DESIRED_FINGERPRINT" ]
}

k3s_is_running() {
  bash -c "$DNS_K3S_ACTIVE_COMMAND" >/dev/null 2>&1
}

k3s_start_token() {
  bash -c "$DNS_K3S_START_COMMAND" 2>/dev/null || true
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
  echo "No systemctl available to restart k3s; restart cannot be performed." >&2
  return 1
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

# Restart and verify every workload in a namespace, in a stable order. Rollout
# status proves the new pods (and their resolv.conf) actually became ready.
# Workload discovery errors must never be mistaken for an empty namespace: an
# API/RBAC failure here would otherwise let activation be recorded `active`
# without recreating the pods that still carry the old resolver.
reconcile_namespace() {
  local namespace="$1"
  local resources status stderr_file message
  stderr_file="$(mktemp)"
  resources="$("$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get deploy,statefulset,daemonset -o name 2>"$stderr_file")" && status=0 || status=$?
  message="$(cat "$stderr_file" 2>/dev/null || true)"
  rm -f "$stderr_file"
  if [ "$status" -ne 0 ]; then
    # A namespace that does not exist yet (fresh install / not installed) is
    # legitimately empty; any other failure (RBAC, API down) must fail activation.
    if printf '%s' "$message" | grep -qiE 'not found|no resources found'; then
      log "Namespace ${namespace} is not present yet; nothing to recreate."
      return 0
    fi
    echo "Could not list workloads in ${namespace}: ${message:-kubectl exited ${status}}" >&2
    return 1
  fi
  if [ -z "$resources" ]; then
    log "No workloads found in ${namespace}."
    return 0
  fi
  local resource
  while IFS= read -r resource; do
    [ -n "$resource" ] || continue
    if ! "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" rollout restart "$resource" >/dev/null; then
      echo "Could not restart ${resource} in ${namespace}." >&2
      return 1
    fi
  done <<< "$resources"
  local failed=0
  while IFS= read -r resource; do
    [ -n "$resource" ] || continue
    if ! "$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" rollout status "$resource" --timeout="${DNS_ROLLOUT_TIMEOUT_SECONDS}s" >/dev/null; then
      echo "Rollout of ${resource} in ${namespace} did not complete within ${DNS_ROLLOUT_TIMEOUT_SECONDS}s." >&2
      failed=1
    fi
  done <<< "$resources"
  return "$failed"
}

# Report pods that are not owned by a restarted controller so the operator knows
# they still carry the old resolver and were not repaired by this helper.
report_unmanaged_pods() {
  local namespace="$1"
  local json
  json="$("$KUBECTL_BIN" --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get pods -o json 2>/dev/null || true)"
  [ -n "$json" ] || return 0
  local names
  names="$(printf '%s' "$json" | node -e '
    const fs = require("fs");
    let value;
    try { value = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(0); }
    const controlledKinds = new Set(["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"]);
    for (const pod of value.items || []) {
      const owners = pod.metadata?.ownerReferences || [];
      const controlled = owners.some((owner) => controlledKinds.has(owner.kind));
      const phase = pod.status?.phase;
      if (!controlled && (phase === "Running" || phase === "Pending")) {
        process.stdout.write(`${pod.metadata.name}\n`);
      }
    }
  ' 2>/dev/null || true)"
  local name
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    log "Unmanaged pod ${namespace}/${name} still carries the previous resolver and was not recreated; recreate it manually."
  done <<< "$names"
}

restart_existing_workloads() {
  local namespace
  for namespace in $DNS_NAMESPACE_GROUPS; do
    log "Recreating workloads in ${namespace} so new pods adopt the resolver."
    reconcile_namespace "$namespace" || return 1
  done
  for namespace in $DNS_NAMESPACE_GROUPS; do
    report_unmanaged_pods "$namespace"
  done
}

activate() {
  local stored_from stored_fp current_token
  stored_from="$(status_field restartFrom)"
  stored_fp="$(status_field fingerprint)"
  current_token="$(k3s_start_token)"

  # A previous restart is only trusted when it belongs to the current
  # fingerprint AND the k3s start token actually changed. A stage record alone
  # never proves the restart succeeded. This check is independent of the stored
  # stage: a prior *failed rollout* also already restarted k3s, so resuming must
  # skip the restart instead of restarting the cluster again on every reconcile.
  local restart_already_done=false
  if [ "$stored_fp" = "$DESIRED_FINGERPRINT" ] \
    && [ -n "$stored_from" ] && [ -n "$current_token" ] && [ "$stored_from" != "$current_token" ]; then
    restart_already_done=true
  fi

  if $restart_already_done; then
    log "Resuming a pending DNS activation; k3s was already restarted for fingerprint ${DESIRED_FINGERPRINT:0:12}."
    write_status restart-confirmed
  else
    do_restart "$current_token" || return 1
  fi

  # Re-verify the host files survived the restart before claiming the new
  # resolver is in effect.
  if ! file_matches "$RESOLV_TARGET" "$DESIRED_RESOLV" || ! file_matches "$DROPIN_TARGET" "$DESIRED_DROPIN"; then
    write_status failed "k3s resolver files changed during activation; refusing to record completion."
    return 1
  fi

  write_status rolling-out
  if ! restart_existing_workloads; then
    write_status failed "One or more workload rollouts did not become ready."
    return 1
  fi
  write_status active
  log "Activated resolver configuration fingerprint ${DESIRED_FINGERPRINT:0:12}."
}

do_restart() {
  local current_token="$1"
  log "Restarting k3s once to apply the resolver configuration."
  RESTART_FROM="$current_token"
  write_status restarting
  if ! restart_k3s; then
    write_status failed "k3s restart command failed."
    return 1
  fi
  if ! wait_for_api; then
    write_status failed "Kubernetes API did not become ready after the k3s restart."
    return 1
  fi
  local after
  after="$(k3s_start_token)"
  if [ -n "$current_token" ] && [ -n "$after" ] && [ "$current_token" = "$after" ]; then
    write_status failed "k3s start time did not change after the restart; activation is not verified."
    return 1
  fi
  RESTART_TOKEN="$after"
  write_status restart-confirmed
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

RESOLV_TARGET="$(rooted "$K3S_RESOLV_CONF")"
DROPIN_TARGET="$(rooted "$K3S_DNS_DROPIN")"

if $DRY_RUN; then
  if ! read_setup_dns; then
    exit 1
  fi
  gather_resolvers
  render_files
  plan "write ${K3S_RESOLV_CONF} (${#RESOLVERS[@]} nameserver lines, no search domains)"
  plan "write ${K3S_DNS_DROPIN} (resolv-conf: ${K3S_RESOLV_CONF})"
  if $INITIAL_MODE && ! k3s_is_running; then
    plan "record activation for the imminent k3s start (no restart)"
  elif activation_is_active; then
    plan "no change; k3s restart skipped"
  else
    plan "restart k3s and recreate workloads: CoreDNS, storage, Flux, application, control plane"
  fi
  exit 0
fi

acquire_lock

# Re-read and re-render under the lock: setup inputs may have changed while we
# waited, and we must generate from the current configuration.
if ! read_setup_dns; then
  write_status failed "Could not read setup inputs."
  exit 1
fi
if ! gather_resolvers; then
  write_status failed "No usable resolver configuration."
  exit 1
fi
render_files

# The configuration identity the control plane submitted for. If the persisted
# setup inputs no longer resolve to it, the operator changed the configuration
# after submitting: refuse to activate, so an old submission can never label a
# different configuration as verified. Only compare when the caller supplied one.
CONFIG_FINGERPRINT="$(setup_inputs_config_fingerprint)"
if [ -n "$DNS_CONFIG_FINGERPRINT_EXPECTED" ] && [ "$CONFIG_FINGERPRINT" != "$DNS_CONFIG_FINGERPRINT_EXPECTED" ]; then
  write_status failed "The requested DNS configuration changed before activation; refusing to record a different configuration as active."
  echo "DNS configuration failure: the submitted configuration no longer matches the persisted setup inputs." >&2
  exit 1
fi

resolv_current=false
dropin_current=false
file_matches "$RESOLV_TARGET" "$DESIRED_RESOLV" && resolv_current=true
file_matches "$DROPIN_TARGET" "$DESIRED_DROPIN" && dropin_current=true

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

# First boot. Only claim activation when k3s has genuinely not started; if it is
# already running the files were written too late to reach kubelet, so activate.
if $INITIAL_MODE; then
  if k3s_is_running; then
    log "k3s is already running; --initial cannot record activation. Activating instead."
    INITIAL_MODE=false
    ACTIVATE_OVERRIDE="true"
  else
    write_status active
    log "Recorded DNS activation for the imminent k3s start."
    exit 0
  fi
fi

if [ "$ACTIVATE_OVERRIDE" = "false" ]; then
  log "Activation skipped (--no-activate)."
  exit 0
fi

if activation_is_active; then
  write_status active
  log "DNS configuration already active for fingerprint ${DESIRED_FINGERPRINT:0:12}; no restart."
  exit 0
fi

activate
