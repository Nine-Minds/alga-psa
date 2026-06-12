#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ISO_ROOT/../../.." && pwd)"
OVERLAY_ROOT="$ISO_ROOT/overlay"
CONTROL_PLANE_ARGS=()
CONTROL_PLANE_IMAGE_CONFIGURED=0
BUILD_CONTROL_PLANE_IMAGE="${ALGA_APPLIANCE_CONTROL_PLANE_BUILD_IMAGE:-1}"
K3S_BINARY="${ALGA_APPLIANCE_K3S_BINARY:-}"
K3S_VERSION="${ALGA_APPLIANCE_K3S_VERSION:-v1.31.6+k3s1}"
DOWNLOAD_K3S="${ALGA_APPLIANCE_K3S_DOWNLOAD:-1}"

usage() {
  cat <<'EOF'
Usage:
  stage-host-artifacts.sh [options]

Stages host-side artifacts required by the Ubuntu/k3s appliance into an ISO
overlay tree. By default this stages the traditional appliance files plus the
Kubernetes-hosted setup control-plane bundle and builds the baked control-plane
image archive.

Options:
  --repo-root <path>                 Repository root (default: inferred)
  --overlay-root <path>              Overlay filesystem root (default: ee/appliance/ubuntu-iso/overlay)
  --control-plane-image-archive <p>  Prebuilt control-plane image archive; may be repeated
  --k3s-binary <path>                Prebuilt k3s binary to stage into /opt/alga-appliance/bin/k3s
  --download-k3s                     Download k3s during staging (default)
  --no-download-k3s                  Do not download k3s; requires --k3s-binary for production ISOs
  --build-control-plane-image        Build and save localhost/alga-appliance-control-plane:baked
  --no-build-control-plane-image     Do not build the control-plane image; use archives already provided/staged
  --allow-missing-control-plane-image Permit staging without a control-plane image archive for tests only
  --help                            Show this help

Environment:
  ALGA_APPLIANCE_STATUS_UI_SKIP_BUILD=1       Reuse an existing status-ui/dist bundle
  ALGA_APPLIANCE_CONTROL_PLANE_BUILD_IMAGE=0  Disable default control-plane image build
  ALGA_APPLIANCE_K3S_BINARY=/path/to/k3s      Use an existing k3s binary
  ALGA_APPLIANCE_K3S_DOWNLOAD=0               Disable default k3s download
  ALGA_APPLIANCE_K3S_VERSION=v1.31.6+k3s1     k3s release to download
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --overlay-root)
      OVERLAY_ROOT="$2"
      shift 2
      ;;
    --control-plane-image-archive)
      CONTROL_PLANE_ARGS+=(--image-archive "$2")
      CONTROL_PLANE_IMAGE_CONFIGURED=1
      shift 2
      ;;
    --k3s-binary)
      K3S_BINARY="$2"
      DOWNLOAD_K3S=0
      shift 2
      ;;
    --download-k3s)
      DOWNLOAD_K3S=1
      shift
      ;;
    --no-download-k3s)
      DOWNLOAD_K3S=0
      shift
      ;;
    --build-control-plane-image)
      BUILD_CONTROL_PLANE_IMAGE=1
      shift
      ;;
    --no-build-control-plane-image)
      BUILD_CONTROL_PLANE_IMAGE=0
      shift
      ;;
    --allow-missing-control-plane-image)
      CONTROL_PLANE_ARGS+=(--allow-missing-image)
      CONTROL_PLANE_IMAGE_CONFIGURED=1
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

DEST_ROOT="$OVERLAY_ROOT/opt/alga-appliance"
SRC_APPLIANCE_ROOT="$REPO_ROOT/ee/appliance"
TARGET_SYSTEMD="$OVERLAY_ROOT/etc/systemd/system"
TARGET_BUILD_INFO_DIR="$OVERLAY_ROOT/etc/alga-appliance"
CONSOLE_SERVICE="$ISO_ROOT/overlay/etc/systemd/system/alga-appliance-console.service"

rm -rf "$DEST_ROOT"
mkdir -p "$DEST_ROOT" "$TARGET_SYSTEMD" "$TARGET_BUILD_INFO_DIR"

cp "$SRC_APPLIANCE_ROOT/appliance" "$DEST_ROOT/appliance"
cp -R "$SRC_APPLIANCE_ROOT/host-service" "$DEST_ROOT/host-service"
cp -R "$SRC_APPLIANCE_ROOT/operator" "$DEST_ROOT/operator"
cp -R "$SRC_APPLIANCE_ROOT/scripts" "$DEST_ROOT/scripts"
cp -R "$SRC_APPLIANCE_ROOT/manifests" "$DEST_ROOT/manifests"
cp -R "$SRC_APPLIANCE_ROOT/flux" "$DEST_ROOT/flux"
cp -R "$SRC_APPLIANCE_ROOT/releases" "$DEST_ROOT/releases"
mkdir -p "$DEST_ROOT/status-ui"

if [[ -f "$SRC_APPLIANCE_ROOT/status-ui/package.json" && "${ALGA_APPLIANCE_STATUS_UI_SKIP_BUILD:-0}" != "1" ]]; then
  if [[ ! -d "$SRC_APPLIANCE_ROOT/status-ui/node_modules" ]]; then
    (cd "$SRC_APPLIANCE_ROOT/status-ui" && npm ci)
  fi
  (cd "$SRC_APPLIANCE_ROOT/status-ui" && npm run build)
fi

if [[ -d "$SRC_APPLIANCE_ROOT/status-ui/dist" ]]; then
  cp -R "$SRC_APPLIANCE_ROOT/status-ui/dist" "$DEST_ROOT/status-ui/dist"
elif [[ "${ALGA_APPLIANCE_STATUS_UI_ALLOW_MISSING_DIST:-0}" == "1" ]]; then
  mkdir -p "$DEST_ROOT/status-ui/dist"
else
  echo "status-ui dist bundle is missing; run status-ui build before packaging" >&2
  exit 1
fi

chmod 0755 "$DEST_ROOT/appliance"
find "$DEST_ROOT/scripts" -type f -name '*.sh' -exec chmod 0755 {} +

if [[ -f "$CONSOLE_SERVICE" ]]; then
  console_target="$TARGET_SYSTEMD/alga-appliance-console.service"
  if [[ "$(realpath -m "$CONSOLE_SERVICE")" != "$(realpath -m "$console_target")" ]]; then
    install -m 0644 "$CONSOLE_SERVICE" "$console_target"
  fi
fi

if [[ -z "$K3S_BINARY" && "$DOWNLOAD_K3S" == "1" ]]; then
  require_downloader=""
  if command -v curl >/dev/null 2>&1; then
    require_downloader="curl"
  elif command -v wget >/dev/null 2>&1; then
    require_downloader="wget"
  else
    echo "curl or wget is required to download k3s; pass --k3s-binary or --no-download-k3s" >&2
    exit 1
  fi
  K3S_BINARY="$(mktemp -t alga-appliance-k3s.XXXXXX)"
  k3s_url="https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION}/k3s"
  echo "Downloading k3s ${K3S_VERSION} from $k3s_url"
  if [[ "$require_downloader" == "curl" ]]; then
    curl -fL --retry 3 --retry-delay 2 -o "$K3S_BINARY" "$k3s_url"
  else
    wget -O "$K3S_BINARY" "$k3s_url"
  fi
  chmod 0755 "$K3S_BINARY"
fi

if [[ -n "$K3S_BINARY" ]]; then
  CONTROL_PLANE_ARGS+=(--k3s-binary "$K3S_BINARY")
fi

BUILD_TIMESTAMP="${ALGA_APPLIANCE_BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
cat > "$TARGET_BUILD_INFO_DIR/build-info.json" <<EOF
{
  "buildTimestamp": "$BUILD_TIMESTAMP"
}
EOF

if [[ "$BUILD_CONTROL_PLANE_IMAGE" == "1" ]]; then
  CONTROL_PLANE_ARGS+=(--build-image)
  CONTROL_PLANE_IMAGE_CONFIGURED=1
fi

if [[ "$CONTROL_PLANE_IMAGE_CONFIGURED" -eq 0 ]]; then
  CONTROL_PLANE_ARGS+=(--allow-missing-image)
fi

"$SRC_APPLIANCE_ROOT/scripts/stage-control-plane-bundle.sh" \
  --repo-root "$REPO_ROOT" \
  --overlay-root "$OVERLAY_ROOT" \
  "${CONTROL_PLANE_ARGS[@]}"

cat <<MSG
Staged host appliance artifacts:
- $DEST_ROOT/appliance
- $DEST_ROOT/host-service
- $DEST_ROOT/operator
- $DEST_ROOT/scripts
- $DEST_ROOT/manifests
- $DEST_ROOT/flux
- $DEST_ROOT/releases
- $DEST_ROOT/status-ui
- $DEST_ROOT/control-plane
MSG
