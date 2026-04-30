#!/usr/bin/env bash
set -euo pipefail

SITE_ID="appliance-single-node"
PROFILE="talos-single-node"
RELEASE_VERSION=""
BOOTSTRAP_MODE=""
CLUSTER_NAME="alga-appliance"
HOSTNAME_VALUE=""
APP_URL=""
NODE_IP=""
NETWORK_MODE=""
INTERFACE_NAME=""
STATIC_ADDRESS=""
STATIC_GATEWAY=""
DNS_SERVERS=""
INSTALL_DISK="/dev/sda"
KUBECONFIG_PATH="${KUBECONFIG:-}"
TALOSCONFIG_PATH="${TALOSCONFIG:-}"
KUBECONFIG_EXPLICIT=false
TALOSCONFIG_EXPLICIT=false
CONFIG_DIR=""
ALGA_CORE_TAG=""
WORKFLOW_WORKER_TAG=""
EMAIL_SERVICE_TAG=""
TEMPORAL_WORKER_TAG=""
ALGA_AUTH_KEY_VALUE=""
REPO_URL=""
REPO_BRANCH=""
REPO_PATH="ee/appliance/flux/base"
OUTPUT_DIR_OVERRIDE=""
DRY_RUN=false
PREPULL_IMAGES=false
STATUS_TOKEN=""
STATUS_TOKEN_PATH=""
TEMP_WORK_DIR=""
TEMP_PROFILE_DIR=""
RELEASE_APP_VERSION=""
RELEASE_APP_BRANCH=""
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

if [ -n "$KUBECONFIG_PATH" ]; then
  KUBECONFIG_EXPLICIT=true
fi

if [ -n "$TALOSCONFIG_PATH" ]; then
  TALOSCONFIG_EXPLICIT=true
fi

usage() {
  cat <<'EOF'
Usage:
  bootstrap-appliance.sh [options]

Options:
  --site-id <id>                 Appliance/site identifier (default: appliance-single-node)
  --release-version <version>    Appliance release version from ee/appliance/releases/
  --profile <name>               Values profile name (default: talos-single-node)
  --bootstrap-mode <mode>        Bootstrap mode: fresh or recover
  --node-ip <ip>                 Talos node IP for first boot and ongoing access
  --hostname <name>              Appliance hostname
  --app-url <url>               Public application URL (for example: https://psa.example.com)
  --cluster-name <name>          Talos cluster name (default: alga-appliance)
  --interface <name>             Network interface name to persist (for example: enp0s1)
  --network-mode <dhcp|static>   Network mode to persist in Talos config
  --static-address <cidr>        Static IPv4 address in CIDR form
  --static-gateway <ip>          Static IPv4 default gateway
  --dns-servers <csv>            Comma-separated resolvers (for example: 8.8.8.8,1.1.1.1)
  --install-disk <path>          Talos install disk (default: /dev/sda)
  --config-dir <path>            Directory for persisted talosconfig, kubeconfig, and values
  --kubeconfig <path>            Existing kubeconfig path (explicitly reuses installed cluster)
  --talosconfig <path>           Existing talosconfig path
  --repo-url <url>               Git repository URL for Flux source
  --repo-branch <branch>         Git repository branch for Flux source
  --repo-path <path>             Repo path for Flux kustomization (default: ee/appliance/flux/base)
  --alga-core-tag <tag>          Override manifest tag for alga-core server/setup image
  --workflow-worker-tag <tag>    Override manifest tag for workflow-worker image
  --email-service-tag <tag>      Override manifest tag for email-service image
  --temporal-worker-tag <tag>    Override manifest tag for temporal-worker image
  --alga-auth-key <value>        ALGA_AUTH_KEY value for msp/alga-psa-shared
  --prepull-images               Pre-pull large app images onto the Talos node before GitOps apply
  --dry-run                      Print the planned commands without mutating cluster state
  --help                         Show this help

If kubeconfig is not supplied, the script will generate Talos config, apply it to
the node, bootstrap the cluster, persist talosconfig and kubeconfig under
~/.alga-psa-appliance/<site-id>/ by default, install storage, install Flux, apply
runtime values derived from the appliance release manifest, and wait for the
first-run Alga bootstrap to complete. Set ALGA_APPLIANCE_HOME to override the
default operator config root.

Bootstrap modes:
  fresh    Wipes existing appliance namespaces and local-path data before reinstall
  recover  Preserves existing appliance state and reuses surviving PVC-backed data
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

is_interactive() {
  [ -t 0 ]
}

prompt_value() {
  local prompt="$1"
  local default_value="${2:-}"
  local value=""

  if ! is_interactive; then
    echo "$default_value"
    return 0
  fi

  if [ -n "$default_value" ]; then
    read -r -p "$prompt [$default_value]: " value
    if [ -z "$value" ]; then
      value="$default_value"
    fi
  else
    read -r -p "$prompt: " value
  fi

  echo "$value"
}

prompt_secret() {
  local prompt="$1"
  local value=""

  if ! is_interactive; then
    echo ""
    return 0
  fi

  read -r -s -p "$prompt: " value
  printf '\n' >&2
  echo "$value"
}

generate_auth_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
  fi
}

generate_status_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
  fi
}

yaml_string() {
  python3 - "$1" <<'PY'
import json
import sys

print(json.dumps(sys.argv[1]))
PY
}

url_host() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse

raw = sys.argv[1]
parsed = urlparse(raw)
if not parsed.scheme or not parsed.netloc:
    raise SystemExit(f"Invalid URL: {raw}")
print(parsed.netloc)
PY
}

infer_node_ip_from_kubeconfig() {
  [ -f "$KUBECONFIG_PATH" ] || return 0

  python3 - "$KUBECONFIG_PATH" <<'PY'
import re
import sys
from urllib.parse import urlparse

text = open(sys.argv[1], 'r', encoding='utf-8').read()
match = re.search(r'^\s*server:\s*(\S+)\s*$', text, re.MULTILINE)
if not match:
    raise SystemExit(0)
parsed = urlparse(match.group(1))
if parsed.hostname:
    print(parsed.hostname)
PY
}

resolve_default_app_url() {
  local inferred_ip="${NODE_IP:-}"

  if [ -z "$inferred_ip" ] && [ -f "$CONFIG_DIR/node-ip" ]; then
    inferred_ip="$(tr -d '\n' < "$CONFIG_DIR/node-ip")"
  fi

  if [ -z "$inferred_ip" ]; then
    inferred_ip="$(infer_node_ip_from_kubeconfig || true)"
  fi

  if [ -n "$inferred_ip" ]; then
    printf 'http://%s:3000\n' "$inferred_ip"
  else
    printf 'http://localhost:3000\n'
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

talos_cmd() {
  run_cmd talosctl --talosconfig "$TALOSCONFIG_PATH" -n "$NODE_IP" -e "$NODE_IP" "$@"
}

cleanup() {
  if [ -n "$TEMP_WORK_DIR" ] && [ -d "$TEMP_WORK_DIR" ]; then
    rm -rf "$TEMP_WORK_DIR"
  fi
}

trap cleanup EXIT

persist_operator_metadata() {
  if $DRY_RUN; then
    echo "+ write operator metadata files under $CONFIG_DIR (node-ip, app-url)"
    return 0
  fi

  if [ -n "$NODE_IP" ]; then
    printf '%s\n' "$NODE_IP" > "$CONFIG_DIR/node-ip"
  fi

  if [ -n "$APP_URL" ]; then
    printf '%s\n' "$APP_URL" > "$CONFIG_DIR/app-url"
  fi
}

status_node_ip() {
  local value="${NODE_IP:-}"
  if [ -z "$value" ] && [ -f "$CONFIG_DIR/node-ip" ]; then
    value="$(tr -d '\n' < "$CONFIG_DIR/node-ip")"
  fi
  if [ -z "$value" ]; then
    value="$(infer_node_ip_from_kubeconfig || true)"
  fi
  printf '%s\n' "$value"
}

resolve_release_version() {
  local releases_dir
  local latest_release

  releases_dir="$REPO_ROOT/ee/appliance/releases"

  if [ -n "$RELEASE_VERSION" ]; then
    return 0
  fi

  latest_release="$(find "$releases_dir" -mindepth 1 -maxdepth 1 -type d ! -name channels -exec basename {} \; | sort -V | tail -n 1)"
  RELEASE_VERSION="$latest_release"
}

resolve_repo_defaults() {
  if [ -z "$REPO_URL" ]; then
    REPO_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
  fi

  if [ -z "$REPO_BRANCH" ]; then
    REPO_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  fi
}

resolve_config_paths() {
  local config_root

  if [ -n "$OUTPUT_DIR_OVERRIDE" ]; then
    CONFIG_DIR="$OUTPUT_DIR_OVERRIDE"
  elif [ -z "$CONFIG_DIR" ]; then
    config_root="${ALGA_APPLIANCE_HOME:-$HOME/.alga-psa-appliance}"
    CONFIG_DIR="$config_root/$SITE_ID"
  fi

  mkdir -p "$CONFIG_DIR"

  if [ -z "$TALOSCONFIG_PATH" ]; then
    TALOSCONFIG_PATH="$CONFIG_DIR/talosconfig"
  fi

  if [ -z "$KUBECONFIG_PATH" ]; then
    KUBECONFIG_PATH="$CONFIG_DIR/kubeconfig"
  fi

  STATUS_TOKEN_PATH="$CONFIG_DIR/status-token"
}

reuse_existing_cluster_config() {
  [ "$KUBECONFIG_EXPLICIT" = true ] && [ -f "$KUBECONFIG_PATH" ]
}

resolve_runtime_inputs() {
  resolve_release_version
  resolve_repo_defaults
  resolve_config_paths

  if [ -z "$HOSTNAME_VALUE" ]; then
    HOSTNAME_VALUE="$SITE_ID"
  fi

  if [ -z "$APP_URL" ] && [ -f "$CONFIG_DIR/app-url" ]; then
    APP_URL="$(tr -d '\n' < "$CONFIG_DIR/app-url")"
  fi

  if [ -z "$APP_URL" ]; then
    local default_app_url
    default_app_url="$(resolve_default_app_url)"
    if is_interactive; then
      APP_URL="$(prompt_value "Public application URL" "$default_app_url")"
    else
      APP_URL="$default_app_url"
    fi
  fi

  if [ -z "$RELEASE_VERSION" ]; then
    echo "Unable to resolve an appliance release version. Use --release-version." >&2
    exit 1
  fi

  if [ ! -f "$REPO_ROOT/ee/appliance/releases/$RELEASE_VERSION/release.json" ]; then
    echo "Release manifest not found: $REPO_ROOT/ee/appliance/releases/$RELEASE_VERSION/release.json" >&2
    exit 1
  fi

  RELEASE_APP_VERSION="$(release_field '.app.version')"
  RELEASE_APP_BRANCH="$(release_field '.app.releaseBranch')"

  if [ -z "$ALGA_CORE_TAG" ] || [ "$ALGA_CORE_TAG" = "null" ]; then
    ALGA_CORE_TAG="$(release_field '.app.images.algaCore')"
  fi
  if [ -z "$WORKFLOW_WORKER_TAG" ] || [ "$WORKFLOW_WORKER_TAG" = "null" ]; then
    WORKFLOW_WORKER_TAG="$(release_field '.app.images.workflowWorker')"
  fi
  if [ -z "$EMAIL_SERVICE_TAG" ] || [ "$EMAIL_SERVICE_TAG" = "null" ]; then
    EMAIL_SERVICE_TAG="$(release_field '.app.images.emailService')"
  fi
  if [ -z "$TEMPORAL_WORKER_TAG" ] || [ "$TEMPORAL_WORKER_TAG" = "null" ]; then
    TEMPORAL_WORKER_TAG="$(release_field '.app.images.temporalWorker')"
  fi

  if [ -z "$REPO_URL" ]; then
    REPO_URL="$(prompt_value "Git repository URL")"
  fi

  if [ -z "$REPO_BRANCH" ]; then
    REPO_BRANCH="$(prompt_value "Git repository branch")"
  fi

  if ! reuse_existing_cluster_config && [ -z "$NODE_IP" ]; then
    NODE_IP="$(prompt_value "Talos node IP")"
  fi

  if [ -z "$BOOTSTRAP_MODE" ]; then
    if is_interactive; then
      BOOTSTRAP_MODE="$(prompt_value "Bootstrap mode (fresh/recover)" "recover")"
    else
      echo "Bootstrap mode is required in non-interactive use. Pass --bootstrap-mode fresh|recover." >&2
      exit 1
    fi
  fi

  case "$BOOTSTRAP_MODE" in
    fresh|recover)
      ;;
    *)
      echo "Invalid bootstrap mode: $BOOTSTRAP_MODE. Use fresh or recover." >&2
      exit 1
      ;;
  esac

  if ! reuse_existing_cluster_config && [ -z "$NETWORK_MODE" ]; then
    NETWORK_MODE="$(prompt_value "Network mode (dhcp/static)" "dhcp")"
  fi

  if ! reuse_existing_cluster_config && [ -z "$INTERFACE_NAME" ]; then
    INTERFACE_NAME="$(prompt_value "Network interface name" "enp0s1")"
  fi

  if ! reuse_existing_cluster_config && [ "$NETWORK_MODE" = "static" ]; then
    if [ -z "$STATIC_ADDRESS" ]; then
      STATIC_ADDRESS="$(prompt_value "Static IPv4 address in CIDR form")"
    fi
    if [ -z "$STATIC_GATEWAY" ]; then
      STATIC_GATEWAY="$(prompt_value "Static default gateway")"
    fi
  fi

  if ! reuse_existing_cluster_config && [ -z "$DNS_SERVERS" ] && is_interactive; then
    DNS_SERVERS="$(prompt_value "DNS resolvers (comma-separated, leave blank to accept defaults)" "")"
  fi

  if [ -z "$ALGA_CORE_TAG" ] && is_interactive; then
    ALGA_CORE_TAG="$(prompt_value "Tag for alga-core")"
  fi
  if [ -z "$WORKFLOW_WORKER_TAG" ] && is_interactive; then
    WORKFLOW_WORKER_TAG="$(prompt_value "Tag for workflow-worker")"
  fi
  if [ -z "$EMAIL_SERVICE_TAG" ] && is_interactive; then
    EMAIL_SERVICE_TAG="$(prompt_value "Tag for email-service")"
  fi
  if [ -z "$TEMPORAL_WORKER_TAG" ] && is_interactive; then
    TEMPORAL_WORKER_TAG="$(prompt_value "Tag for temporal-worker")"
  fi

  if [ -z "$ALGA_CORE_TAG" ] || [ -z "$WORKFLOW_WORKER_TAG" ] || [ -z "$EMAIL_SERVICE_TAG" ] || [ -z "$TEMPORAL_WORKER_TAG" ]; then
    echo "Release manifest or CLI overrides must provide tags for alga-core, workflow-worker, email-service, and temporal-worker." >&2
    exit 1
  fi

  if [ -n "$APP_URL" ]; then
    url_host "$APP_URL" >/dev/null
  fi
}

release_field() {
  local jq_filter="$1"
  jq -r "$jq_filter" "$REPO_ROOT/ee/appliance/releases/$RELEASE_VERSION/release.json"
}

set_yaml_value() {
  local file_path="$1"
  local dotted_path="$2"
  local value="$3"

  python3 - "$file_path" "$dotted_path" "$value" <<'PY'
import sys
from pathlib import Path

file_path = Path(sys.argv[1])
target = sys.argv[2].split(".")
value = sys.argv[3]
lines = file_path.read_text().splitlines()
stack = []
replaced = False
output = []

for line in lines:
    stripped = line.lstrip()
    indent = len(line) - len(stripped)

    while stack and indent <= stack[-1][0]:
        stack.pop()

    if stripped.endswith(":") and not stripped.startswith("- "):
        stack.append((indent, stripped[:-1].strip()))
        output.append(line)
        continue

    current = [key for _, key in stack]
    if current == target[:-1] and stripped.startswith(f"{target[-1]}:"):
        output.append(f"{line[:indent]}{target[-1]}: {value}")
        replaced = True
    else:
        output.append(line)

if not replaced:
    raise SystemExit(f"Failed to update {'.'.join(target)} in {file_path}")

file_path.write_text("\n".join(output) + "\n")
PY
}

write_machine_config_documents() {
  local controlplane_path="$CONFIG_DIR/controlplane.yaml"

  python3 - "$controlplane_path" "$HOSTNAME_VALUE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
hostname = sys.argv[2]
lines = path.read_text().splitlines()
out = []
in_hostname_doc = False
hostname_set = False

for line in lines:
    stripped = line.strip()

    if stripped == "---":
        in_hostname_doc = False
        out.append(line)
        continue

    if stripped == "kind: HostnameConfig":
        in_hostname_doc = True
        out.append(line)
        continue

    if in_hostname_doc and stripped.startswith("auto:"):
        out.append(f"hostname: {hostname}")
        hostname_set = True
        continue

    out.append(line)

if not hostname_set:
    out.extend([
        "---",
        "apiVersion: v1alpha1",
        "kind: HostnameConfig",
        f"hostname: {hostname}",
    ])

path.write_text("\n".join(out) + "\n")
PY

  if [ "$NETWORK_MODE" = "static" ]; then
    cat >>"$controlplane_path" <<EOF
---
apiVersion: v1alpha1
kind: LinkConfig
name: ${INTERFACE_NAME}
up: true
dhcp: false
addresses:
  - ${STATIC_ADDRESS}
routes:
  - network: 0.0.0.0/0
    gateway: ${STATIC_GATEWAY}
EOF
  else
    cat >>"$controlplane_path" <<EOF
---
apiVersion: v1alpha1
kind: DHCPv4Config
name: ${INTERFACE_NAME}
routeMetric: 1024
EOF
  fi

  if [ -n "$DNS_SERVERS" ]; then
    {
      printf '%s\n' '---'
      printf '%s\n' 'apiVersion: v1alpha1'
      printf '%s\n' 'kind: ResolverConfig'
      printf '%s\n' 'nameservers:'
      printf '%s\n' "$DNS_SERVERS" | tr ',' '\n' | while IFS= read -r resolver; do
        resolver="$(printf '%s' "$resolver" | xargs)"
        [ -n "$resolver" ] || continue
        printf '  - address: %s\n' "$resolver"
      done
    } >>"$controlplane_path"
  fi

  cat >>"$controlplane_path" <<'EOF'
---
apiVersion: v1alpha1
kind: TimeSyncConfig
bootTimeout: 2m
EOF
}

generate_machine_config() {
  local release_manifest
  local talos_version
  local kubernetes_version
  local installer_image
  local patch_file

  talos_version="$(release_field '.talos.version')"
  kubernetes_version="$(release_field '.kubernetes.version')"
  installer_image="$(release_field '.os.installer.image')"

  if [ -z "$installer_image" ] || [ "$installer_image" = "null" ]; then
    echo "Release manifest is missing os.installer.image for release $RELEASE_VERSION" >&2
    exit 1
  fi

  patch_file="$CONFIG_DIR/controlplane-patch.yaml"
  cat >"$patch_file" <<'EOF'
cluster:
  allowSchedulingOnControlPlanes: true
machine:
  features:
    hostDNS:
      enabled: false
EOF

  if $DRY_RUN; then
    echo "+ talosctl gen config $CLUSTER_NAME https://$NODE_IP:6443 --output $CONFIG_DIR --output-types controlplane,talosconfig --force --install-disk $INSTALL_DISK --install-image $installer_image --kubernetes-version $kubernetes_version --talos-version $talos_version --config-patch-control-plane @$patch_file"
    echo "+ append HostnameConfig and network configuration to $CONFIG_DIR/controlplane.yaml"
    return 0
  fi

  talosctl gen config "$CLUSTER_NAME" "https://$NODE_IP:6443" \
    --output "$CONFIG_DIR" \
    --output-types controlplane,talosconfig \
    --force \
    --install-disk "$INSTALL_DISK" \
    --install-image "$installer_image" \
    --kubernetes-version "$kubernetes_version" \
    --talos-version "$talos_version" \
    --config-patch-control-plane "@$patch_file"

  write_machine_config_documents

  chmod 600 "$CONFIG_DIR/talosconfig" "$CONFIG_DIR/controlplane.yaml"
  TALOSCONFIG_PATH="$CONFIG_DIR/talosconfig"
}

wait_for_talos_maintenance() {
  local attempt

  if $DRY_RUN; then
    echo "+ wait for Talos maintenance API on $NODE_IP"
    return 0
  fi

  for attempt in $(seq 1 30); do
    if talosctl get disks --insecure -n "$NODE_IP" -e "$NODE_IP" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  echo "Timed out waiting for Talos maintenance API on $NODE_IP" >&2
  exit 1
}

wait_for_talos_api() {
  local attempt

  if $DRY_RUN; then
    echo "+ wait for secure Talos API on $NODE_IP"
    return 0
  fi

  for attempt in $(seq 1 60); do
    if talosctl --talosconfig "$TALOSCONFIG_PATH" -n "$NODE_IP" -e "$NODE_IP" version >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  echo "Timed out waiting for secure Talos API on $NODE_IP" >&2
  exit 1
}

wait_for_kubernetes_api() {
  local attempt

  if $DRY_RUN; then
    echo "+ wait for Kubernetes API on $NODE_IP"
    return 0
  fi

  for attempt in $(seq 1 60); do
    if kubectl --kubeconfig "$KUBECONFIG_PATH" get --raw=/readyz >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  echo "Timed out waiting for Kubernetes API on $NODE_IP" >&2
  exit 1
}

wait_for_kubernetes_node_ready() {
  local attempt

  if $DRY_RUN; then
    echo "+ wait for Kubernetes node $HOSTNAME_VALUE to become Ready"
    return 0
  fi

  wait_for_kubernetes_api

  for attempt in $(seq 1 60); do
    if kubectl --kubeconfig "$KUBECONFIG_PATH" get node "$HOSTNAME_VALUE" >/dev/null 2>&1; then
      if kubectl --kubeconfig "$KUBECONFIG_PATH" wait --for=condition=Ready --timeout=10s "node/$HOSTNAME_VALUE" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 5
  done

  echo "Timed out waiting for Kubernetes node $HOSTNAME_VALUE to become Ready" >&2
  exit 1
}

bootstrap_talos_cluster() {
  if reuse_existing_cluster_config; then
    return 0
  fi

  if [ -z "$NODE_IP" ]; then
    echo "Talos node IP is required for first boot." >&2
    exit 1
  fi

  wait_for_talos_maintenance
  run_cmd talosctl apply-config --insecure --nodes "$NODE_IP" --file "$CONFIG_DIR/controlplane.yaml"
  run_cmd talosctl config endpoint "$NODE_IP" --talosconfig "$TALOSCONFIG_PATH"
  run_cmd talosctl config node "$NODE_IP" --talosconfig "$TALOSCONFIG_PATH"
  wait_for_talos_api
  run_cmd talosctl bootstrap --talosconfig "$TALOSCONFIG_PATH" -n "$NODE_IP" -e "$NODE_IP"
  run_cmd talosctl kubeconfig "$KUBECONFIG_PATH" --talosconfig "$TALOSCONFIG_PATH" -n "$NODE_IP" -e "$NODE_IP" --force --merge=false
  wait_for_kubernetes_node_ready

  if ! $DRY_RUN; then
    chmod 600 "$KUBECONFIG_PATH"
  fi
}

ensure_namespace() {
  local namespace="$1"

  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH create namespace $namespace --dry-run=client -o yaml | kubectl apply -f -"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" create namespace "$namespace" --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
}

secret_exists() {
  local namespace="$1"
  local name="$2"
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get secret "$name" >/dev/null 2>&1
}

ensure_alga_auth_secret() {
  ensure_namespace "msp"

  if secret_exists "msp" "alga-psa-shared" && [ -z "$ALGA_AUTH_KEY_VALUE" ]; then
    echo "Reusing existing secret msp/alga-psa-shared"
    return 0
  fi

  if [ -z "$ALGA_AUTH_KEY_VALUE" ]; then
    if is_interactive; then
      ALGA_AUTH_KEY_VALUE="$(prompt_secret "ALGA_AUTH_KEY (leave blank to auto-generate)")"
    fi
    if [ -z "$ALGA_AUTH_KEY_VALUE" ]; then
      ALGA_AUTH_KEY_VALUE="$(generate_auth_key)"
      echo "Generated ALGA_AUTH_KEY for msp/alga-psa-shared"
    fi
  fi

  if $DRY_RUN; then
    echo "+ kubectl create/apply secret msp/alga-psa-shared"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp create secret generic alga-psa-shared \
    --from-literal=ALGA_AUTH_KEY="$ALGA_AUTH_KEY_VALUE" \
    --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
}

ensure_status_token() {
  if [ -z "$STATUS_TOKEN" ] && [ -f "$STATUS_TOKEN_PATH" ]; then
    STATUS_TOKEN="$(tr -d '\n' < "$STATUS_TOKEN_PATH")"
  fi

  if [ -z "$STATUS_TOKEN" ]; then
    STATUS_TOKEN="$(generate_status_token)"
  fi

  if $DRY_RUN; then
    echo "+ write status token to $STATUS_TOKEN_PATH"
    return 0
  fi

  printf '%s\n' "$STATUS_TOKEN" > "$STATUS_TOKEN_PATH"
  chmod 600 "$STATUS_TOKEN_PATH"
}

ensure_status_auth_secret() {
  ensure_namespace "appliance-system"

  if $DRY_RUN; then
    echo "+ kubectl create/apply secret appliance-system/appliance-status-auth"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n appliance-system create secret generic appliance-status-auth \
    --from-literal=token="$STATUS_TOKEN" \
    --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
}

create_runtime_values_dir() {
  local source_profile_dir="$REPO_ROOT/ee/appliance/flux/profiles/$PROFILE"
  local values_dir
  local kustomization_file

  TEMP_WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alga-appliance-profile.XXXXXX")"
  TEMP_PROFILE_DIR="$TEMP_WORK_DIR/profile"
  values_dir="$TEMP_PROFILE_DIR/values"
  mkdir -p "$values_dir"

  cp "$source_profile_dir/values/"*.yaml "$values_dir/"

  set_yaml_value "$values_dir/alga-core.$PROFILE.yaml" "bootstrap.mode" "$BOOTSTRAP_MODE"
  set_yaml_value "$values_dir/alga-core.$PROFILE.yaml" "setup.image.tag" "$(yaml_string "$ALGA_CORE_TAG")"
  set_yaml_value "$values_dir/alga-core.$PROFILE.yaml" "server.image.tag" "$(yaml_string "$ALGA_CORE_TAG")"
  if [ -n "$APP_URL" ]; then
    local app_host
    app_host="$(url_host "$APP_URL")"
    set_yaml_value "$values_dir/alga-core.$PROFILE.yaml" "appUrl" "$(yaml_string "$APP_URL")"
    set_yaml_value "$values_dir/alga-core.$PROFILE.yaml" "host" "$(yaml_string "$app_host")"
    set_yaml_value "$values_dir/alga-core.$PROFILE.yaml" "domainSuffix" '""'
  fi
  set_yaml_value "$values_dir/workflow-worker.$PROFILE.yaml" "image.tag" "$(yaml_string "$WORKFLOW_WORKER_TAG")"
  set_yaml_value "$values_dir/email-service.$PROFILE.yaml" "image.tag" "$(yaml_string "$EMAIL_SERVICE_TAG")"
  set_yaml_value "$values_dir/temporal-worker.$PROFILE.yaml" "image.tag" "$(yaml_string "$TEMPORAL_WORKER_TAG")"

  mkdir -p "$CONFIG_DIR/values"
  cp "$values_dir/"*.yaml "$CONFIG_DIR/values/"

  kustomization_file="$TEMP_PROFILE_DIR/kustomization.yaml"
  cat >"$kustomization_file" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
generatorOptions:
  disableNameSuffixHash: true
configMapGenerator:
  - name: appliance-values-alga-core
    namespace: alga-system
    files:
      - alga-core.$PROFILE.yaml=values/alga-core.$PROFILE.yaml
  - name: appliance-values-pgbouncer
    namespace: alga-system
    files:
      - pgbouncer.$PROFILE.yaml=values/pgbouncer.$PROFILE.yaml
  - name: appliance-values-temporal
    namespace: alga-system
    files:
      - temporal.$PROFILE.yaml=values/temporal.$PROFILE.yaml
  - name: appliance-values-workflow-worker
    namespace: alga-system
    files:
      - workflow-worker.$PROFILE.yaml=values/workflow-worker.$PROFILE.yaml
  - name: appliance-values-email-service
    namespace: alga-system
    files:
      - email-service.$PROFILE.yaml=values/email-service.$PROFILE.yaml
  - name: appliance-values-temporal-worker
    namespace: alga-system
    files:
      - temporal-worker.$PROFILE.yaml=values/temporal-worker.$PROFILE.yaml
EOF
}

apply_release_selection() {
  local release_branch
  release_branch="${RELEASE_APP_BRANCH:-unknown}"

  if $DRY_RUN; then
    echo "+ kubectl create/apply configmap alga-system/appliance-release-selection"
    return 0
  fi

  ensure_namespace "alga-system"

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system create configmap appliance-release-selection \
    --from-literal=releaseVersion="$RELEASE_VERSION" \
    --from-literal=appVersion="$RELEASE_APP_VERSION" \
    --from-literal=releaseBranch="$release_branch" \
    --from-literal=algaCoreTag="$ALGA_CORE_TAG" \
    --from-literal=workflowWorkerTag="$WORKFLOW_WORKER_TAG" \
    --from-literal=emailServiceTag="$EMAIL_SERVICE_TAG" \
    --from-literal=temporalWorkerTag="$TEMPORAL_WORKER_TAG" \
    --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
}

reset_appliance_state_if_requested() {
  if [ "$BOOTSTRAP_MODE" != "fresh" ]; then
    return 0
  fi

  if $DRY_RUN; then
    run_cmd "$REPO_ROOT/ee/appliance/scripts/reset-appliance-data.sh" --kubeconfig "$KUBECONFIG_PATH" --force --dry-run
    return 0
  fi

  run_cmd "$REPO_ROOT/ee/appliance/scripts/reset-appliance-data.sh" --kubeconfig "$KUBECONFIG_PATH" --force
}

install_flux_if_needed() {
  if kubectl --kubeconfig "$KUBECONFIG_PATH" -n flux-system get deployment source-controller >/dev/null 2>&1; then
    return 0
  fi

  if $DRY_RUN; then
    echo "+ flux --kubeconfig $KUBECONFIG_PATH install --namespace flux-system --export | kubectl apply -f -"
    return 0
  fi

  flux --kubeconfig "$KUBECONFIG_PATH" install --namespace flux-system --export | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n flux-system rollout status deployment/source-controller --timeout=5m
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n flux-system rollout status deployment/kustomize-controller --timeout=5m
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n flux-system rollout status deployment/helm-controller --timeout=5m
}

configure_coredns_upstreams() {
  local resolvers
  local rendered

  if [ -z "$DNS_SERVERS" ]; then
    return 0
  fi

  resolvers="$(printf '%s' "$DNS_SERVERS" | tr ',' ' ' | xargs)"

  if [ -z "$resolvers" ]; then
    return 0
  fi

  if $DRY_RUN; then
    echo "+ patch kube-system/coredns to forward to: $resolvers"
    return 0
  fi

  rendered="$(KUBECONFIG="$KUBECONFIG_PATH" kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | sed "s#forward \\. /etc/resolv.conf {#forward . $resolvers {#")"

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n kube-system patch configmap coredns --type merge \
    -p "$(printf '{"data":{"Corefile":%s}}' "$(printf '%s' "$rendered" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n kube-system rollout restart deployment/coredns
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n kube-system rollout status deployment/coredns --timeout=5m
}

apply_runtime_values() {
  if $DRY_RUN; then
    echo "+ kubectl --kubeconfig $KUBECONFIG_PATH apply -k $TEMP_PROFILE_DIR"
    return 0
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" apply -k "$TEMP_PROFILE_DIR"
}

install_gitops_sync() {
  if $DRY_RUN; then
    echo "+ flux --kubeconfig $KUBECONFIG_PATH create source git alga-appliance --url=$REPO_URL --branch=$REPO_BRANCH --interval=1m --export | kubectl apply -f -"
    echo "+ flux --kubeconfig $KUBECONFIG_PATH create kustomization alga-appliance --source=GitRepository/alga-appliance.flux-system --path=./$REPO_PATH --prune=true --wait=true --export | kubectl apply -f -"
    return 0
  fi

  flux --kubeconfig "$KUBECONFIG_PATH" create source git alga-appliance \
    --url="$REPO_URL" \
    --branch="$REPO_BRANCH" \
    --interval=1m \
    --timeout=5m \
    --export | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -

  flux --kubeconfig "$KUBECONFIG_PATH" create kustomization alga-appliance \
    --source=GitRepository/alga-appliance.flux-system \
    --path="./$REPO_PATH" \
    --prune=true \
    --wait=true \
    --interval=5m \
    --retry-interval=1m \
    --export | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n flux-system wait --for=condition=Ready --timeout=5m gitrepository/alga-appliance
}

wait_for_alga_core_release() {
  local attempt

  if $DRY_RUN; then
    echo "+ wait for helmrelease/alga-core to be created in namespace alga-system"
    return 0
  fi

  for attempt in $(seq 1 120); do
    if kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system get helmrelease/alga-core >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  echo "Timed out waiting for Flux to create helmrelease/alga-core" >&2
  exit 1
}

prepull_images() {
  if ! $PREPULL_IMAGES; then
    return 0
  fi

  if [ -z "$NODE_IP" ] || [ ! -f "$TALOSCONFIG_PATH" ]; then
    return 0
  fi

  talos_cmd image pull "ghcr.io/nine-minds/alga-psa-ee:${ALGA_CORE_TAG}"
  talos_cmd image pull "ghcr.io/nine-minds/workflow-worker:${WORKFLOW_WORKER_TAG}"
  talos_cmd image pull "ghcr.io/nine-minds/email-service:${EMAIL_SERVICE_TAG}"
  talos_cmd image pull "ghcr.io/nine-minds/temporal-worker:${TEMPORAL_WORKER_TAG}"
}

promote_bootstrap_mode_to_recover() {
  local values_file
  local requested_at

  if [ "$BOOTSTRAP_MODE" != "fresh" ]; then
    return 0
  fi

  if $DRY_RUN; then
    echo "+ promote bootstrap.mode from fresh to recover after successful initial bootstrap"
    return 0
  fi

  values_file="$TEMP_PROFILE_DIR/values/alga-core.$PROFILE.yaml"
  if [ -f "$values_file" ]; then
    set_yaml_value "$values_file" "bootstrap.mode" "recover"
  fi

  values_file="$CONFIG_DIR/values/alga-core.$PROFILE.yaml"
  if [ -f "$values_file" ]; then
    set_yaml_value "$values_file" "bootstrap.mode" "recover"
  fi

  kubectl --kubeconfig "$KUBECONFIG_PATH" apply -k "$TEMP_PROFILE_DIR"
  requested_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system annotate helmrelease alga-core \
    reconcile.fluxcd.io/requestedAt="$requested_at" --overwrite >/dev/null
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system wait --for=condition=Ready --timeout=30m helmrelease/alga-core
  BOOTSTRAP_MODE="recover"
}

wait_for_bootstrap() {
  if $DRY_RUN; then
    cat <<EOF
Watch progress with:
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n flux-system get gitrepositories,kustomizations
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system get helmreleases
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp get pods
EOF
    return 0
  fi

  wait_for_alga_core_release
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system wait --for=condition=Ready --timeout=30m helmrelease/alga-core
  local bootstrap_job
  bootstrap_job="$(kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp get jobs -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^alga-core-sebastian-bootstrap' | tail -n 1 || true)"
  if [ -n "$bootstrap_job" ]; then
    kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp wait --for=condition=complete --timeout=20m "job/${bootstrap_job}"
  fi
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp rollout status deployment/alga-core-sebastian --timeout=20m
  promote_bootstrap_mode_to_recover
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --site-id)
      SITE_ID="$2"
      shift 2
      ;;
    --release-version)
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --bootstrap-mode)
      BOOTSTRAP_MODE="$2"
      shift 2
      ;;
    --node-ip)
      NODE_IP="$2"
      shift 2
      ;;
    --hostname)
      HOSTNAME_VALUE="$2"
      shift 2
      ;;
    --app-url)
      APP_URL="$2"
      shift 2
      ;;
    --cluster-name)
      CLUSTER_NAME="$2"
      shift 2
      ;;
    --interface)
      INTERFACE_NAME="$2"
      shift 2
      ;;
    --network-mode)
      NETWORK_MODE="$2"
      shift 2
      ;;
    --static-address)
      STATIC_ADDRESS="$2"
      shift 2
      ;;
    --static-gateway)
      STATIC_GATEWAY="$2"
      shift 2
      ;;
    --dns-servers)
      DNS_SERVERS="$2"
      shift 2
      ;;
    --install-disk)
      INSTALL_DISK="$2"
      shift 2
      ;;
    --config-dir)
      CONFIG_DIR="$2"
      shift 2
      ;;
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      KUBECONFIG_EXPLICIT=true
      shift 2
      ;;
    --talosconfig)
      TALOSCONFIG_PATH="$2"
      TALOSCONFIG_EXPLICIT=true
      shift 2
      ;;
    --repo-url)
      REPO_URL="$2"
      shift 2
      ;;
    --repo-branch)
      REPO_BRANCH="$2"
      shift 2
      ;;
    --repo-path)
      REPO_PATH="$2"
      shift 2
      ;;
    --alga-core-tag)
      ALGA_CORE_TAG="$2"
      shift 2
      ;;
    --workflow-worker-tag)
      WORKFLOW_WORKER_TAG="$2"
      shift 2
      ;;
    --email-service-tag)
      EMAIL_SERVICE_TAG="$2"
      shift 2
      ;;
    --temporal-worker-tag)
      TEMPORAL_WORKER_TAG="$2"
      shift 2
      ;;
    --alga-auth-key)
      ALGA_AUTH_KEY_VALUE="$2"
      shift 2
      ;;
    --prepull-images)
      PREPULL_IMAGES=true
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

require_command git
require_command jq
require_command kubectl
require_command flux
require_command python3
require_command talosctl

resolve_runtime_inputs
create_runtime_values_dir

if ! reuse_existing_cluster_config; then
  generate_machine_config
  bootstrap_talos_cluster
fi

reset_appliance_state_if_requested

ensure_namespace "msp"
ensure_namespace "alga-system"
ensure_status_token
ensure_status_auth_secret
if $DRY_RUN; then
  run_cmd "$REPO_ROOT/ee/appliance/scripts/install-storage.sh" --kubeconfig "$KUBECONFIG_PATH" --dry-run
else
  run_cmd "$REPO_ROOT/ee/appliance/scripts/install-storage.sh" --kubeconfig "$KUBECONFIG_PATH"
fi
install_flux_if_needed
configure_coredns_upstreams
ensure_alga_auth_secret
apply_runtime_values
apply_release_selection
prepull_images
install_gitops_sync
wait_for_bootstrap

persist_operator_metadata

cat <<EOF
Appliance bootstrap submitted.

Appliance status UI:
  URL:   http://$(status_node_ip):8080
  Token: ${STATUS_TOKEN}

Persisted operator files:
  Talos config: $TALOSCONFIG_PATH
  Kubeconfig:   $KUBECONFIG_PATH
  Machine config: $CONFIG_DIR/controlplane.yaml
  Status token: $STATUS_TOKEN_PATH
  Values: $CONFIG_DIR/values/

Support bundle:
  $REPO_ROOT/ee/appliance/scripts/collect-support-bundle.sh --kubeconfig "$KUBECONFIG_PATH" --talosconfig "$TALOSCONFIG_PATH" --node-ip "$NODE_IP" --site-id "$SITE_ID"
EOF
