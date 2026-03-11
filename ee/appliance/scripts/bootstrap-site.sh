#!/usr/bin/env bash
set -euo pipefail

SITE_ID="site01"
PROFILE="talos-single-node"
KUBECONFIG_PATH="${KUBECONFIG:-}"
IMAGE_TAG=""
ALGA_CORE_TAG=""
WORKFLOW_WORKER_TAG=""
EMAIL_SERVICE_TAG=""
TEMPORAL_WORKER_TAG=""
ALGA_AUTH_KEY_VALUE=""
DEFAULT_IMAGE_TAG="latest"
TEMP_PROFILE_DIR=""
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  bootstrap-site.sh [options]

Options:
  --site-id <id>                 Logical site identifier (default: site01)
  --profile <name>               Appliance profile name (default: talos-single-node)
  --kubeconfig <path>            Kubeconfig path
  --image-tag <tag>              Default tag for all Alga application images
  --alga-core-tag <tag>          Tag for alga-core server/setup image
  --workflow-worker-tag <tag>    Tag for workflow-worker image
  --email-service-tag <tag>      Tag for email-service image
  --temporal-worker-tag <tag>    Tag for temporal-worker image
  --alga-auth-key <value>        ALGA_AUTH_KEY value for alga-psa-shared
  --help                         Show this help

If required values are omitted and stdin is interactive, the script prompts for
them. In non-interactive mode, missing required values cause an error.
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

cleanup() {
  if [ -n "$TEMP_PROFILE_DIR" ] && [ -d "$TEMP_PROFILE_DIR" ]; then
    rm -rf "$TEMP_PROFILE_DIR"
  fi
}

secret_exists() {
  local namespace="$1"
  local name="$2"
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n "$namespace" get secret "$name" >/dev/null 2>&1
}

ensure_namespace() {
  local namespace="$1"
  kubectl --kubeconfig "$KUBECONFIG_PATH" get namespace "$namespace" >/dev/null 2>&1 || \
    kubectl --kubeconfig "$KUBECONFIG_PATH" create namespace "$namespace" >/dev/null
}

ensure_alga_auth_secret() {
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

  kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp create secret generic alga-psa-shared \
    --from-literal=ALGA_AUTH_KEY="$ALGA_AUTH_KEY_VALUE" \
    --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG_PATH" apply -f -
}

profile_values_file() {
  local component="$1"
  printf '%s/values/%s.%s.yaml' "$TEMP_PROFILE_DIR" "$component" "$PROFILE"
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

resolve_image_tags() {
  if [ -z "$IMAGE_TAG" ] && \
     [ -z "$ALGA_CORE_TAG" ] && \
     [ -z "$WORKFLOW_WORKER_TAG" ] && \
     [ -z "$EMAIL_SERVICE_TAG" ] && \
     [ -z "$TEMPORAL_WORKER_TAG" ] && \
     is_interactive; then
    IMAGE_TAG="$(prompt_value "Application image tag for all Alga services" "$DEFAULT_IMAGE_TAG")"
  fi

  if [ -n "$IMAGE_TAG" ]; then
    : "${ALGA_CORE_TAG:=$IMAGE_TAG}"
    : "${WORKFLOW_WORKER_TAG:=$IMAGE_TAG}"
    : "${EMAIL_SERVICE_TAG:=$IMAGE_TAG}"
    : "${TEMPORAL_WORKER_TAG:=$IMAGE_TAG}"
  fi
}

create_profile_override_dir() {
  local base_profile_dir="$REPO_ROOT/ee/appliance/flux/profiles/$PROFILE"

  TEMP_PROFILE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alga-appliance-profile.XXXXXX")"
  cp -R "$base_profile_dir"/. "$TEMP_PROFILE_DIR"/

  if [ -n "$ALGA_CORE_TAG" ]; then
    set_yaml_value "$(profile_values_file "alga-core")" "setup.image.tag" "$ALGA_CORE_TAG"
    set_yaml_value "$(profile_values_file "alga-core")" "server.image.tag" "$ALGA_CORE_TAG"
  fi

  if [ -n "$WORKFLOW_WORKER_TAG" ]; then
    set_yaml_value "$(profile_values_file "workflow-worker")" "image.tag" "$WORKFLOW_WORKER_TAG"
  fi

  if [ -n "$EMAIL_SERVICE_TAG" ]; then
    set_yaml_value "$(profile_values_file "email-service")" "image.tag" "$EMAIL_SERVICE_TAG"
  fi

  if [ -n "$TEMPORAL_WORKER_TAG" ]; then
    set_yaml_value "$(profile_values_file "temporal-worker")" "image.tag" "$TEMPORAL_WORKER_TAG"
  fi
}

trap cleanup EXIT

while [ "$#" -gt 0 ]; do
  case "$1" in
    --site-id)
      SITE_ID="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --kubeconfig)
      KUBECONFIG_PATH="$2"
      shift 2
      ;;
    --image-tag)
      IMAGE_TAG="$2"
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
require_command python3

if [ -z "$KUBECONFIG_PATH" ]; then
  KUBECONFIG_PATH="$(prompt_value "Kubeconfig path" "${KUBECONFIG:-}")"
fi

if [ -z "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig path is required via --kubeconfig, KUBECONFIG, or interactive input" >&2
  exit 1
fi

if [ ! -f "$KUBECONFIG_PATH" ]; then
  echo "Kubeconfig file not found: $KUBECONFIG_PATH" >&2
  exit 1
fi

kubectl --kubeconfig "$KUBECONFIG_PATH" get namespace flux-system >/dev/null 2>&1 || {
  echo "Flux namespace flux-system is not present. Bootstrap Flux before applying the appliance profile." >&2
  exit 1
}

resolve_image_tags
ensure_namespace "msp"
ensure_alga_auth_secret

if [ -n "$ALGA_CORE_TAG" ] || \
   [ -n "$WORKFLOW_WORKER_TAG" ] || \
   [ -n "$EMAIL_SERVICE_TAG" ] || \
   [ -n "$TEMPORAL_WORKER_TAG" ]; then
  create_profile_override_dir
fi

echo "Bootstrapping Alga appliance site '$SITE_ID' with profile '$PROFILE'..."
if [ -n "$TEMP_PROFILE_DIR" ]; then
  "$REPO_ROOT/ee/appliance/scripts/deploy-app.sh" \
    --profile "$PROFILE" \
    --profile-dir "$TEMP_PROFILE_DIR" \
    --kubeconfig "$KUBECONFIG_PATH"
else
  "$REPO_ROOT/ee/appliance/scripts/deploy-app.sh" \
    --profile "$PROFILE" \
    --kubeconfig "$KUBECONFIG_PATH"
fi

cat <<EOF
Apply submitted.

Watch progress with:
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n alga-system get helmreleases
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp get pods
  kubectl --kubeconfig "$KUBECONFIG_PATH" -n msp logs job/alga-core-sebastian-bootstrap -f
EOF
