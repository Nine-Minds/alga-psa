#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$ISO_ROOT/../../.." && pwd)"

DEST_ROOT="$ISO_ROOT/overlay/opt/alga-appliance"
SRC_APPLIANCE_ROOT="$REPO_ROOT/ee/appliance"

rm -rf "$DEST_ROOT"
mkdir -p "$DEST_ROOT"/{operator,scripts,status-ui}

cp "$SRC_APPLIANCE_ROOT/appliance" "$DEST_ROOT/appliance"
cp -R "$SRC_APPLIANCE_ROOT/operator" "$DEST_ROOT/operator"
cp -R "$SRC_APPLIANCE_ROOT/scripts" "$DEST_ROOT/scripts"

if [[ -d "$SRC_APPLIANCE_ROOT/status-ui/dist" ]]; then
  cp -R "$SRC_APPLIANCE_ROOT/status-ui/dist" "$DEST_ROOT/status-ui/dist"
else
  echo "warning: status-ui dist bundle is missing; run status-ui build before packaging" >&2
fi

chmod 0755 "$DEST_ROOT/appliance"
find "$DEST_ROOT/scripts" -type f -name '*.sh' -exec chmod 0755 {} +

cat <<MSG
Staged host appliance artifacts:
- $DEST_ROOT/appliance
- $DEST_ROOT/operator
- $DEST_ROOT/scripts
- $DEST_ROOT/status-ui
MSG
