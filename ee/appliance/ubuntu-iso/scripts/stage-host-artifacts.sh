#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ISO_ROOT/../../.." && pwd)"

DEST_ROOT="$ISO_ROOT/overlay/opt/alga-appliance"
SRC_APPLIANCE_ROOT="$REPO_ROOT/ee/appliance"

rm -rf "$DEST_ROOT"
mkdir -p "$DEST_ROOT"

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
else
  echo "status-ui dist bundle is missing; run status-ui build before packaging" >&2
  exit 1
fi

chmod 0755 "$DEST_ROOT/appliance"
find "$DEST_ROOT/scripts" -type f -name '*.sh' -exec chmod 0755 {} +

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
MSG
