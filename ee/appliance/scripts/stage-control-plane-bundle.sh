#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"
OVERLAY_ROOT=""
IMAGE_ARCHIVE=""
K3S_BINARY=""
ALLOW_MISSING_IMAGE=false
BUILD_IMAGE=false

usage() {
  cat <<'EOF'
Usage:
  stage-control-plane-bundle.sh --overlay-root <path> [options]

Stages the baked Kubernetes-hosted appliance control-plane bundle into an ISO
overlay or installed-root tree. The resulting files are rooted at:

  <overlay-root>/opt/alga-appliance/control-plane/

Options:
  --repo-root <path>       Repository root (default: inferred from this script)
  --overlay-root <path>    Overlay filesystem root to populate
  --image-archive <path>   Control-plane image archive to copy; may be repeated
  --k3s-binary <path>      k3s binary to stage at /opt/alga-appliance/bin/k3s
  --build-image            Build and save localhost/alga-appliance-control-plane:baked before staging
  --allow-missing-image    Permit staging without an image archive for dry-run tests
  --help                  Show this help
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
    --image-archive)
      if [ -n "$IMAGE_ARCHIVE" ]; then
        IMAGE_ARCHIVE="${IMAGE_ARCHIVE}:$2"
      else
        IMAGE_ARCHIVE="$2"
      fi
      shift 2
      ;;
    --k3s-binary)
      K3S_BINARY="$2"
      shift 2
      ;;
    --build-image)
      BUILD_IMAGE=true
      shift
      ;;
    --allow-missing-image)
      ALLOW_MISSING_IMAGE=true
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

if [ -z "$OVERLAY_ROOT" ]; then
  echo "--overlay-root is required" >&2
  usage >&2
  exit 2
fi

CONTROL_PLANE_DIR="$REPO_ROOT/ee/appliance/control-plane"
MANIFEST_DIR="$CONTROL_PLANE_DIR/manifests"
HOST_SERVICE_DIR="$REPO_ROOT/ee/appliance/host-service"
LOCAL_STORAGE_MANIFEST="$REPO_ROOT/ee/appliance/manifests/local-path-storage.yaml"
TARGET_ROOT="$OVERLAY_ROOT/opt/alga-appliance"
TARGET_CONTROL_PLANE="$TARGET_ROOT/control-plane"
TARGET_MANIFESTS="$TARGET_CONTROL_PLANE/manifests"
TARGET_IMAGES="$TARGET_CONTROL_PLANE/images"
TARGET_APPLIANCE_MANIFESTS="$TARGET_ROOT/manifests"
TARGET_HOST_SERVICE="$TARGET_ROOT/host-service"
TARGET_BIN="$TARGET_ROOT/bin"
TARGET_SCRIPTS="$TARGET_ROOT/scripts"
TARGET_SYSTEMD="$OVERLAY_ROOT/etc/systemd/system"
TARGET_SYSTEMD_WANTS="$TARGET_SYSTEMD/multi-user.target.wants"
TARGET_SYSUSERS="$OVERLAY_ROOT/etc/sysusers.d"
FALLBACK_SCRIPT="$REPO_ROOT/ee/appliance/bin/alga-control-plane-reapply"
RESET_ADMIN_SCRIPT="$REPO_ROOT/ee/appliance/bin/alga-appliance-reset-admin"
BOOTSTRAP_SCRIPT="$REPO_ROOT/ee/appliance/scripts/bootstrap-control-plane.sh"
STORAGE_SCRIPT="$REPO_ROOT/ee/appliance/scripts/install-storage.sh"
BOOTSTRAP_SERVICE="$REPO_ROOT/ee/appliance/systemd/alga-appliance-bootstrap.service"
HOST_AGENT_SERVICE="$REPO_ROOT/ee/appliance/systemd/alga-host-agent.service"
SYSUSERS_CONF="$REPO_ROOT/ee/appliance/systemd/alga-appliance.sysusers"

if [ ! -d "$MANIFEST_DIR" ]; then
  echo "Control-plane manifest directory not found: $MANIFEST_DIR" >&2
  exit 1
fi

if [ ! -d "$HOST_SERVICE_DIR" ]; then
  echo "Host-service directory not found: $HOST_SERVICE_DIR" >&2
  exit 1
fi

if [ ! -f "$LOCAL_STORAGE_MANIFEST" ]; then
  echo "Local storage manifest not found: $LOCAL_STORAGE_MANIFEST" >&2
  exit 1
fi

if [ ! -f "$FALLBACK_SCRIPT" ]; then
  echo "Fallback script not found: $FALLBACK_SCRIPT" >&2
  exit 1
fi

if [ ! -f "$BOOTSTRAP_SCRIPT" ]; then
  echo "Bootstrap script not found: $BOOTSTRAP_SCRIPT" >&2
  exit 1
fi

if [ ! -f "$STORAGE_SCRIPT" ]; then
  echo "Storage script not found: $STORAGE_SCRIPT" >&2
  exit 1
fi

if [ ! -f "$BOOTSTRAP_SERVICE" ]; then
  echo "Bootstrap service not found: $BOOTSTRAP_SERVICE" >&2
  exit 1
fi

if [ ! -f "$HOST_AGENT_SERVICE" ]; then
  echo "Host agent service not found: $HOST_AGENT_SERVICE" >&2
  exit 1
fi

if [ ! -f "$SYSUSERS_CONF" ]; then
  echo "Sysusers config not found: $SYSUSERS_CONF" >&2
  exit 1
fi

mkdir -p "$TARGET_MANIFESTS" "$TARGET_IMAGES" "$TARGET_APPLIANCE_MANIFESTS" "$TARGET_HOST_SERVICE" "$TARGET_BIN" "$TARGET_SCRIPTS" "$TARGET_SYSTEMD" "$TARGET_SYSTEMD_WANTS" "$TARGET_SYSUSERS"
cp -R "$MANIFEST_DIR"/. "$TARGET_MANIFESTS"/
cp "$HOST_SERVICE_DIR"/*.mjs "$TARGET_HOST_SERVICE"/
chmod 0755 "$TARGET_HOST_SERVICE"/*.mjs
cp "$LOCAL_STORAGE_MANIFEST" "$TARGET_APPLIANCE_MANIFESTS/local-path-storage.yaml"
install -m 0755 "$FALLBACK_SCRIPT" "$TARGET_BIN/alga-control-plane-reapply"
install -m 0755 "$RESET_ADMIN_SCRIPT" "$TARGET_BIN/alga-appliance-reset-admin"
if [ -n "$K3S_BINARY" ]; then
  if [ ! -s "$K3S_BINARY" ]; then
    echo "k3s binary not found or empty: $K3S_BINARY" >&2
    exit 1
  fi
  install -m 0755 "$K3S_BINARY" "$TARGET_BIN/k3s"
fi
install -m 0755 "$BOOTSTRAP_SCRIPT" "$TARGET_SCRIPTS/bootstrap-control-plane.sh"
install -m 0755 "$STORAGE_SCRIPT" "$TARGET_SCRIPTS/install-storage.sh"
install -m 0644 "$BOOTSTRAP_SERVICE" "$TARGET_SYSTEMD/alga-appliance-bootstrap.service"
install -m 0644 "$HOST_AGENT_SERVICE" "$TARGET_SYSTEMD/alga-host-agent.service"
install -m 0644 "$SYSUSERS_CONF" "$TARGET_SYSUSERS/alga-appliance.conf"
ln -sfn ../alga-appliance-bootstrap.service "$TARGET_SYSTEMD_WANTS/alga-appliance-bootstrap.service"
ln -sfn ../alga-host-agent.service "$TARGET_SYSTEMD_WANTS/alga-host-agent.service"
ln -sfn /dev/null "$TARGET_SYSTEMD/alga-appliance.service"
rm -f "$TARGET_SYSTEMD_WANTS/alga-appliance.service"

if [ "$BUILD_IMAGE" = "true" ]; then
  DOCKER_CLI="${DOCKER_BIN:-}"
  if [ -z "$DOCKER_CLI" ]; then
    DOCKER_CLI="$(command -v docker || true)"
    # The snap launcher at /snap/bin/docker can return successful empty output
    # for subcommands such as `docker save` in some environments. Prefer the
    # real packaged client binary when it is present.
    if [ "$DOCKER_CLI" = "/snap/bin/docker" ] && [ -x "/snap/docker/current/bin/docker" ]; then
      DOCKER_CLI="/snap/docker/current/bin/docker"
    fi
  fi
  if [ -z "$DOCKER_CLI" ] || [ ! -x "$DOCKER_CLI" ]; then
    echo "docker is required for --build-image" >&2
    exit 1
  fi
  build_archive="$(mktemp -t alga-appliance-control-plane.XXXXXX.tar)"
  "$DOCKER_CLI" build -f "$CONTROL_PLANE_DIR/Dockerfile" -t localhost/alga-appliance-control-plane:baked "$REPO_ROOT"
  "$DOCKER_CLI" save localhost/alga-appliance-control-plane:baked -o "$build_archive"
  if [ ! -s "$build_archive" ]; then
    echo "Control-plane image archive is empty after docker save: $build_archive" >&2
    exit 1
  fi
  if [ -n "$IMAGE_ARCHIVE" ]; then
    IMAGE_ARCHIVE="$IMAGE_ARCHIVE:$build_archive"
  else
    IMAGE_ARCHIVE="$build_archive"
  fi
fi

archive_count=0
if [ -n "$IMAGE_ARCHIVE" ]; then
  old_ifs="$IFS"
  IFS=':'
  for archive in $IMAGE_ARCHIVE; do
    IFS="$old_ifs"
    if [ ! -f "$archive" ]; then
      echo "Control-plane image archive not found: $archive" >&2
      exit 1
    fi
    if [ ! -s "$archive" ]; then
      echo "Control-plane image archive is empty: $archive" >&2
      exit 1
    fi
    cp "$archive" "$TARGET_IMAGES/$(basename "$archive")"
    archive_count=$((archive_count + 1))
    IFS=':'
  done
  IFS="$old_ifs"
elif compgen -G "$CONTROL_PLANE_DIR/images/*.tar" >/dev/null; then
  for archive in "$CONTROL_PLANE_DIR"/images/*.tar; do
    if [ ! -s "$archive" ]; then
      echo "Control-plane image archive is empty: $archive" >&2
      exit 1
    fi
    cp "$archive" "$TARGET_IMAGES/$(basename "$archive")"
    archive_count=$((archive_count + 1))
  done
fi

if [ "$archive_count" -eq 0 ] && [ "$ALLOW_MISSING_IMAGE" != "true" ]; then
  echo "No control-plane image archive was staged. Build one first or pass --image-archive." >&2
  exit 1
fi

cat > "$TARGET_CONTROL_PLANE/bundle.json" <<EOF
{
  "bundleVersion": 1,
  "origin": "baked-iso",
  "manifestPath": "/opt/alga-appliance/control-plane/manifests",
  "imagePath": "/opt/alga-appliance/control-plane/images",
  "localPathStorageManifest": "/opt/alga-appliance/manifests/local-path-storage.yaml",
  "fallbackCommand": "/opt/alga-appliance/bin/alga-control-plane-reapply",
  "bootstrapScript": "/opt/alga-appliance/scripts/bootstrap-control-plane.sh",
  "k3sBinaryPath": "/opt/alga-appliance/bin/k3s",
  "imageArchiveCount": $archive_count
}
EOF

echo "Staged appliance control-plane bundle at $TARGET_CONTROL_PLANE"
