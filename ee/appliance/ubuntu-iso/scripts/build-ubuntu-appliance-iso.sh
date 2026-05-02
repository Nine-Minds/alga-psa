#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") --base-iso <path> --release-version <version> [--dry-run] [--scaffold]

Builds a custom Ubuntu appliance autoinstall ISO.

Required flags:
  --base-iso <path>         Path to Ubuntu Server 24.04 LTS ISO.
  --release-version <value> Appliance release version used in output naming.

Optional flags:
  --dry-run                 Validate arguments and directory layout only.
  --scaffold                Create a placeholder artifact for unit tests without remastering an ISO.
USAGE
}

BASE_ISO=""
RELEASE_VERSION=""
DRY_RUN=0
SCAFFOLD=0

while (($#)); do
  case "$1" in
    --base-iso)
      BASE_ISO="${2:-}"
      shift 2
      ;;
    --release-version)
      RELEASE_VERSION="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --scaffold)
      SCAFFOLD=1
      shift
      ;;
    -h|--help)
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

if [[ -z "$BASE_ISO" || -z "$RELEASE_VERSION" ]]; then
  echo "--base-iso and --release-version are required" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$BASE_ISO" ]]; then
  echo "Base ISO not found: $BASE_ISO" >&2
  exit 1
fi

for required_dir in \
  "$ROOT_DIR/config/nocloud" \
  "$ROOT_DIR/overlay" \
  "$ROOT_DIR/work" \
  "$ROOT_DIR/output"; do
  if [[ ! -d "$required_dir" ]]; then
    echo "Missing required directory: $required_dir" >&2
    exit 1
  fi
done

for required_file in \
  "$ROOT_DIR/config/nocloud/user-data" \
  "$ROOT_DIR/config/nocloud/meta-data"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required file: $required_file" >&2
    exit 1
  fi
done

STAGE_SCRIPT="$ROOT_DIR/scripts/stage-host-artifacts.sh"
if [[ ! -x "$STAGE_SCRIPT" ]]; then
  echo "Missing executable staging script: $STAGE_SCRIPT" >&2
  exit 1
fi

OUTPUT_ISO="$ROOT_DIR/output/alga-appliance-ubuntu-${RELEASE_VERSION}.iso"
OUTPUT_SHA="$OUTPUT_ISO.sha256"

if [[ "$DRY_RUN" -eq 1 ]]; then
  cat <<DRY
[dry-run] Ubuntu appliance ISO layout validated.
[dry-run] base-iso: $BASE_ISO
[dry-run] release-version: $RELEASE_VERSION
[dry-run] output-iso: $OUTPUT_ISO
DRY
  exit 0
fi

"$STAGE_SCRIPT"

if [[ "$SCAFFOLD" -eq 1 ]]; then
  : > "$OUTPUT_ISO"
  sha256sum "$OUTPUT_ISO" > "$OUTPUT_SHA"
  printf 'Created scaffold artifact and checksum:\n- %s\n- %s\n' "$OUTPUT_ISO" "$OUTPUT_SHA"
  exit 0
fi

if ! command -v xorriso >/dev/null 2>&1; then
  echo "xorriso is required to remaster the Ubuntu appliance ISO. Install xorriso or use --scaffold for layout-only tests." >&2
  exit 1
fi

ISO_WORK="$ROOT_DIR/work/iso-root"
rm -rf "$ISO_WORK"
mkdir -p "$ISO_WORK"

xorriso -osirrox on -indev "$BASE_ISO" -extract / "$ISO_WORK" >/dev/null
chmod -R u+w "$ISO_WORK"

rm -rf "$ISO_WORK/nocloud" "$ISO_WORK/alga-overlay"
cp -R "$ROOT_DIR/config/nocloud" "$ISO_WORK/nocloud"
cp -R "$ROOT_DIR/overlay" "$ISO_WORK/alga-overlay"

for grub_file in "$ISO_WORK/boot/grub/grub.cfg" "$ISO_WORK/boot/grub/loopback.cfg"; do
  if [[ -f "$grub_file" ]]; then
    python3 - "$grub_file" <<'PY'
import sys
from pathlib import Path
path = Path(sys.argv[1])
text = path.read_text()
needle = 'autoinstall ds=nocloud\\;s=/cdrom/nocloud/'
out = []
for line in text.splitlines():
    stripped = line.lstrip()
    if stripped.startswith('linux') and len(stripped) > len('linux') and stripped[len('linux')].isspace() and 'autoinstall' not in line:
        if '---' in line:
            line = line.replace('---', f'{needle} ---', 1)
        else:
            line = f'{line} {needle}'
    out.append(line)
path.write_text('\n'.join(out) + '\n')
PY
  fi
done

rm -f "$OUTPUT_ISO" "$OUTPUT_SHA"
xorriso -as mkisofs \
  -r -V ALGA_UBUNTU \
  -o "$OUTPUT_ISO" \
  -J -joliet-long -l -iso-level 3 \
  -c boot.catalog \
  -b boot/grub/i386-pc/eltorito.img \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot \
  -e EFI/boot/bootx64.efi \
  -no-emul-boot \
  -isohybrid-gpt-basdat \
  "$ISO_WORK"

sha256sum "$OUTPUT_ISO" > "$OUTPUT_SHA"
printf 'Created Ubuntu appliance ISO and checksum:\n- %s\n- %s\n' "$OUTPUT_ISO" "$OUTPUT_SHA"
