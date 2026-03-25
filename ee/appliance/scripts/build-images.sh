#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../../.." && pwd)"

FACTORY_BASE_URL="${EE_APPLIANCE_FACTORY_BASE_URL:-https://factory.talos.dev}"
SCHEMATIC_PATH="${REPO_ROOT}/ee/appliance/schematics/metal-amd64.yaml"
OUT_DIR="${REPO_ROOT}/dist/appliance"
RELEASES_DIR="${REPO_ROOT}/ee/appliance/releases"
VALUES_PROFILE="talos-single-node"
CHANNEL="candidate"
ARCH="amd64"
PLATFORM="metal"
DRY_RUN=0
SCHEMATIC_ID_OVERRIDE="${EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE:-}"

usage() {
  cat <<'EOF'
Usage:
  build-images.sh --release-version <version> --talos-version <version> --kubernetes-version <version> --app-version <version> --app-release-branch <branch> --alga-core-tag <tag> --workflow-worker-tag <tag> --email-service-tag <tag> --temporal-worker-tag <tag> [options]

Options:
  --release-version <version>   Appliance release version (x.y.z)
  --talos-version <version>     Talos version (for example: v1.12.0)
  --kubernetes-version <ver>    Kubernetes version (for example: v1.31.4)
  --app-version <version>       Alga application version/tag carried by the release manifest
  --app-release-branch <name>   App release branch (for example: release/1.0-rc3)
  --alga-core-tag <tag>         Published image tag for alga-core/setup image
  --workflow-worker-tag <tag>   Published image tag for workflow-worker
  --email-service-tag <tag>     Published image tag for email-service
  --temporal-worker-tag <tag>   Published image tag for temporal-worker
  --schematic <path>            Schematic YAML path (default: ee/appliance/schematics/metal-amd64.yaml)
  --out <dir>                   Artifact output directory root (default: dist/appliance)
  --values-profile <name>       Appliance values profile name (default: talos-single-node)
  --channel <name>              Release channel recorded in manifest (default: candidate)
  --dry-run                     Resolve and print artifact metadata without downloading or writing files
  --help                        Show this help

Environment:
  EE_APPLIANCE_FACTORY_BASE_URL     Override the Image Factory base URL
  EE_APPLIANCE_SCHEMATIC_ID_OVERRIDE  Bypass schematic upload and use this schematic ID
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

normalize_version() {
  local version="$1"
  if [[ "$version" =~ ^v ]]; then
    printf '%s\n' "$version"
  else
    printf 'v%s\n' "$version"
  fi
}

sha256_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

resolve_schematic_id() {
  local response=""
  local schematic_id=""

  if [ -n "$SCHEMATIC_ID_OVERRIDE" ]; then
    printf '%s\n' "$SCHEMATIC_ID_OVERRIDE"
    return 0
  fi

  response="$(
    curl --fail --silent --show-error \
      -X POST \
      --data-binary "@${SCHEMATIC_PATH}" \
      "${FACTORY_BASE_URL}/schematics"
  )"
  schematic_id="$(printf '%s\n' "$response" | jq -r '.id // empty')"

  if [ -z "$schematic_id" ]; then
    echo "Image Factory did not return a schematic ID" >&2
    exit 1
  fi

  printf '%s\n' "$schematic_id"
}

resolve_installer_digest() {
  local installer_image="$1"
  local digest=""
  local inspect_output=""

  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  if ! inspect_output="$(docker buildx imagetools inspect "$installer_image" 2>/dev/null)"; then
    return 0
  fi

  digest="$(printf '%s\n' "$inspect_output" | sed -n 's/^[[:space:]]*Digest:[[:space:]]*//p' | head -n 1)"
  if [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    printf '%s\n' "$digest"
  fi
}

render_manifest() {
  local release_version="$1"
  local talos_version="$2"
  local kubernetes_version="$3"
  local app_version="$4"
  local app_release_branch="$5"
  local alga_core_tag="$6"
  local workflow_worker_tag="$7"
  local email_service_tag="$8"
  local temporal_worker_tag="$9"
  local schematic_id="${10}"
  local iso_url="${11}"
  local iso_local_path="${12}"
  local iso_sha256="${13}"
  local installer_image="${14}"
  local installer_digest="${15:-}"

  jq -n \
    --arg releaseVersion "$release_version" \
    --arg generatedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg talosVersion "$talos_version" \
    --arg schematicId "$schematic_id" \
    --arg schematicPath "${SCHEMATIC_PATH#$REPO_ROOT/}" \
    --arg kubernetesVersion "$kubernetes_version" \
    --arg isoUrl "$iso_url" \
    --arg isoLocalPath "$iso_local_path" \
    --arg isoSha256 "$iso_sha256" \
    --arg installerImage "$installer_image" \
    --arg installerDigest "$installer_digest" \
    --arg appVersion "$app_version" \
    --arg appReleaseBranch "$app_release_branch" \
    --arg algaCoreTag "$alga_core_tag" \
    --arg workflowWorkerTag "$workflow_worker_tag" \
    --arg emailServiceTag "$email_service_tag" \
    --arg temporalWorkerTag "$temporal_worker_tag" \
    --arg valuesProfile "$VALUES_PROFILE" \
    --arg channel "$CHANNEL" \
    '
    {
      releaseVersion: $releaseVersion,
      generatedAt: $generatedAt,
      talos: {
        version: $talosVersion,
        schematicId: $schematicId,
        schematicPath: $schematicPath
      },
      kubernetes: {
        version: $kubernetesVersion
      },
      os: {
        platform: "metal",
        architecture: "amd64",
        iso: {
          url: $isoUrl,
          localPath: $isoLocalPath,
          sha256: $isoSha256
        },
        installer: (
          if $installerDigest == "" then
            { image: $installerImage }
          else
            { image: $installerImage, digest: $installerDigest }
          end
        )
      },
      app: {
        version: $appVersion,
        releaseBranch: $appReleaseBranch,
        valuesProfile: $valuesProfile,
        images: {
          algaCore: $algaCoreTag,
          workflowWorker: $workflowWorkerTag,
          emailService: $emailServiceTag,
          temporalWorker: $temporalWorkerTag
        }
      },
      channel: $channel
    }
    '
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-version)
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --talos-version)
      TALOS_VERSION="$2"
      shift 2
      ;;
    --kubernetes-version)
      KUBERNETES_VERSION="$2"
      shift 2
      ;;
    --app-version)
      APP_VERSION="$2"
      shift 2
      ;;
    --app-release-branch)
      APP_RELEASE_BRANCH="$2"
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
    --schematic)
      SCHEMATIC_PATH="$2"
      shift 2
      ;;
    --out)
      OUT_DIR="$2"
      shift 2
      ;;
    --values-profile)
      VALUES_PROFILE="$2"
      shift 2
      ;;
    --channel)
      CHANNEL="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
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

require_command curl
require_command jq
require_command shasum

if [ -z "${RELEASE_VERSION:-}" ] || [ -z "${TALOS_VERSION:-}" ] || [ -z "${KUBERNETES_VERSION:-}" ] || [ -z "${APP_VERSION:-}" ] || [ -z "${APP_RELEASE_BRANCH:-}" ] || [ -z "${ALGA_CORE_TAG:-}" ] || [ -z "${WORKFLOW_WORKER_TAG:-}" ] || [ -z "${EMAIL_SERVICE_TAG:-}" ] || [ -z "${TEMPORAL_WORKER_TAG:-}" ]; then
  echo "Missing required arguments" >&2
  usage >&2
  exit 1
fi

if ! [[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "release-version must follow x.y.z" >&2
  exit 1
fi

TALOS_VERSION="$(normalize_version "$TALOS_VERSION")"
KUBERNETES_VERSION="$(normalize_version "$KUBERNETES_VERSION")"

if [ ! -f "$SCHEMATIC_PATH" ]; then
  echo "Schematic file not found: $SCHEMATIC_PATH" >&2
  exit 1
fi

if [ "$CHANNEL" != "candidate" ] && [ "$CHANNEL" != "stable" ]; then
  echo "channel must be candidate or stable" >&2
  exit 1
fi

SCHEMATIC_ID="$(resolve_schematic_id)"
if ! [[ "$SCHEMATIC_ID" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Resolved schematic ID is invalid: $SCHEMATIC_ID" >&2
  exit 1
fi

ISO_URL="${FACTORY_BASE_URL}/image/${SCHEMATIC_ID}/${TALOS_VERSION}/${PLATFORM}-${ARCH}.iso"
INSTALLER_IMAGE="factory.talos.dev/metal-installer/${SCHEMATIC_ID}:${TALOS_VERSION}"
INSTALLER_DIGEST="$(resolve_installer_digest "$INSTALLER_IMAGE")"

if [ "$DRY_RUN" -eq 1 ]; then
  render_manifest \
    "$RELEASE_VERSION" \
    "$TALOS_VERSION" \
    "$KUBERNETES_VERSION" \
    "$APP_VERSION" \
    "$APP_RELEASE_BRANCH" \
    "$ALGA_CORE_TAG" \
    "$WORKFLOW_WORKER_TAG" \
    "$EMAIL_SERVICE_TAG" \
    "$TEMPORAL_WORKER_TAG" \
    "$SCHEMATIC_ID" \
    "$ISO_URL" \
    "" \
    "" \
    "$INSTALLER_IMAGE" \
    "$INSTALLER_DIGEST"
  exit 0
fi

ARTIFACT_DIR="${OUT_DIR}/${RELEASE_VERSION}"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_VERSION}"
ISO_FILENAME="${PLATFORM}-${ARCH}.iso"
ISO_PATH="${ARTIFACT_DIR}/${ISO_FILENAME}"
ISO_RELATIVE_PATH="${ISO_PATH#$REPO_ROOT/}"
RELEASE_FILE="${RELEASE_DIR}/release.json"

mkdir -p "$ARTIFACT_DIR" "$RELEASE_DIR"

curl --fail --silent --show-error --location "$ISO_URL" --output "$ISO_PATH"

ISO_SHA256="$(sha256_file "$ISO_PATH")"
if [ -z "$ISO_SHA256" ]; then
  echo "Failed to compute SHA-256 for $ISO_PATH" >&2
  exit 1
fi

render_manifest \
  "$RELEASE_VERSION" \
  "$TALOS_VERSION" \
  "$KUBERNETES_VERSION" \
  "$APP_VERSION" \
  "$APP_RELEASE_BRANCH" \
  "$ALGA_CORE_TAG" \
  "$WORKFLOW_WORKER_TAG" \
  "$EMAIL_SERVICE_TAG" \
  "$TEMPORAL_WORKER_TAG" \
  "$SCHEMATIC_ID" \
  "$ISO_URL" \
  "$ISO_RELATIVE_PATH" \
  "$ISO_SHA256" \
  "$INSTALLER_IMAGE" \
  "$INSTALLER_DIGEST" > "$RELEASE_FILE"

cat <<EOF
Built Talos appliance assets for release ${RELEASE_VERSION}

Schematic ID:  ${SCHEMATIC_ID}
ISO URL:       ${ISO_URL}
ISO path:      ${ISO_PATH}
Installer:     ${INSTALLER_IMAGE}
Release file:  ${RELEASE_FILE}
EOF
