#!/bin/bash
set -euo pipefail

# Repair secret-store modes for the filesystem secret provider.
#
# The provider requires the secret root and every directory under it to be mode
# 0700 and every tenant secret file to be mode 0600, so writes are atomic,
# non-symlinked, and unreadable by other users regardless of umask. Installs
# that created these files under a permissive umask (typically 0755 dirs / 0644
# files) can run this once to bring the store in line. It is a one-time,
# non-destructive repair: it never deletes, rewrites, or reads secret contents.
#
# Usage:
#   scripts/repair-secret-permissions.sh                       # dry-run: report only
#   scripts/repair-secret-permissions.sh --apply               # apply mode fixes
#   scripts/repair-secret-permissions.sh --apply --path /shared-tenant-secrets
#   sudo scripts/repair-secret-permissions.sh --apply --uid 1000
#
# Modes:
#   (default)  Dry run. Report every directory/file whose modes are not the
#              expected 0700/0600, every symlink and non-regular entry, and
#              ownership mismatches. Nothing is changed.
#   --apply    Apply the mode fixes (chmod 700 dirs, 600 files) for entries
#              owned by the running user. Ownership mismatches are reported;
#              they are corrected only when running as root with --uid.
#   --path DIR  Secret store root to inspect (default: SECRET_FS_BASE_PATH,
#              else <repo>/secrets).
#   --uid N     With --apply as root, chown repaired entries to uid N.
#
# Symlinks and non-regular entries are never followed or changed; they are
# reported for manual intervention.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APPLY=0
ROOT_ARG=""
TARGET_UID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=1
      shift
      ;;
    --path)
      ROOT_ARG="$2"
      shift 2
      ;;
    --uid)
      TARGET_UID="$2"
      shift 2
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -40
      exit 0
      ;;
    *)
      echo "❌ Unknown argument: $1 (see --help)" >&2
      exit 1
      ;;
  esac
done

# Resolve the secret root the same way the provider does: SECRET_FS_BASE_PATH
# wins, otherwise the repo-root ./secrets directory.
if [ -n "$ROOT_ARG" ]; then
  ROOT="$ROOT_ARG"
elif [ -n "${SECRET_FS_BASE_PATH:-}" ]; then
  ROOT="$SECRET_FS_BASE_PATH"
else
  ROOT="$REPO_ROOT/secrets"
fi

if [ ! -e "$ROOT" ]; then
  echo "⚠️  Secret store $ROOT does not exist yet."
  echo "   The provider creates it with mode 0700 on first write; nothing to repair."
  exit 0
fi

# Prevent --apply from ever following a symlinked root.
if [ -L "$ROOT" ]; then
  echo "❌ Secret store $ROOT is a symlink; refusing to touch it." >&2
  echo "   Fix it manually (the provider refuses writes through symlinks)." >&2
  exit 1
fi
if [ ! -d "$ROOT" ]; then
  echo "❌ Secret store $ROOT is not a directory." >&2
  exit 1
fi

RUNNING_UID="$(id -u)"
EFFECTIVE_OWNER="$(stat -c '%u' "$ROOT")"

if [ "$APPLY" -eq 1 ]; then
  if [ "$TARGET_UID" != "" ] && [ "$RUNNING_UID" != "0" ]; then
    echo "❌ --uid requires running as root (current uid: $RUNNING_UID)." >&2
    exit 1
  fi
  echo "Applying mode fixes under $ROOT (dirs 0700, files 0600)..."
else
  echo "Dry run under $ROOT — reporting only, no changes made. Re-run with --apply to fix modes."
fi

ISSUES=0
APPLIED=0
SKIPPED_OWNERSHIP=0

fix_entry() {
  local path="$1" kind="$2"
  local wanted mode uid
  if [ "$kind" = "dir" ]; then
    wanted=700
  else
    wanted=600
  fi

  mode="$(stat -c '%a' "$path")"
  uid="$(stat -c '%u' "$path")"

  local owner_ok=1
  if [ "$uid" != "$EFFECTIVE_OWNER" ]; then
    owner_ok=0
    echo "⚠️  Owner mismatch: $path (uid $uid, store owner uid $EFFECTIVE_OWNER)"
  fi

  if [ "$mode" != "$wanted" ]; then
    if [ "$APPLY" -eq 1 ]; then
      if [ "$uid" != "$RUNNING_UID" ] && [ "$RUNNING_UID" != "0" ]; then
        echo "⚠️  Not owned by you (uid $uid); cannot chmod: $path"
        ISSUES=$((ISSUES + 1))
        return
      fi
      chmod "$wanted" "$path"
      APPLIED=$((APPLIED + 1))
      echo "✅ Fixed $kind mode to $wanted: $path"
    else
      echo "  $kind mode $mode (expected $wanted): $path"
      ISSUES=$((ISSUES + 1))
    fi
  elif [ "$owner_ok" -eq 0 ] && [ "$APPLY" -eq 1 ] && [ "$RUNNING_UID" = "0" ] && [ "$TARGET_UID" != "" ]; then
    chown "$TARGET_UID" "$path"
    APPLIED=$((APPLIED + 1))
    echo "✅ Fixed owner to uid $TARGET_UID: $path"
  fi
}

# Root directory itself.
ROOT_MODE="$(stat -c '%a' "$ROOT")"
if [ "$ROOT_MODE" != "700" ]; then
  if [ "$APPLY" -eq 1 ] && { [ "$EFFECTIVE_OWNER" = "$RUNNING_UID" ] || [ "$RUNNING_UID" = "0" ]; }; then
    chmod 700 "$ROOT"
    APPLIED=$((APPLIED + 1))
    echo "✅ Fixed dir mode to 700: $ROOT"
  else
    echo "  dir mode $ROOT_MODE (expected 700): $ROOT"
    ISSUES=$((ISSUES + 1))
  fi
fi

# Walk the store. find is used with -P (never follow symlinks); each entry is
# classified by type so symlinks and non-regular entries are reported, not
# followed.
while IFS= read -r entry; do
  if [ -L "$entry" ]; then
    echo "❌ Symlink (manual intervention required): $entry"
    ISSUES=$((ISSUES + 1))
  elif [ -d "$entry" ]; then
    fix_entry "$entry" dir
  elif [ -f "$entry" ]; then
    fix_entry "$entry" file
  else
    echo "❌ Non-regular entry (manual intervention required): $entry"
    ISSUES=$((ISSUES + 1))
  fi
done < <(find -P "$ROOT" -mindepth 1 2>/dev/null)

if [ "$APPLY" -eq 1 ]; then
  echo ""
  echo "✅ Applied $APPLIED permission fix(es)."
  if [ "$ISSUES" -gt 0 ]; then
    echo "⚠️  $ISSUES issue(s) remain — see above (symlinks and non-regular entries need manual intervention; ownership needs root + --uid)."
    exit 1
  fi
else
  echo ""
  if [ "$ISSUES" -eq 0 ]; then
    echo "✅ Store is clean: all directories 0700, all files 0600."
  else
    echo "⚠️  $ISSUES issue(s) found. Re-run with --apply to fix the mode issues; review symlink/ownership items manually."
  fi
fi
