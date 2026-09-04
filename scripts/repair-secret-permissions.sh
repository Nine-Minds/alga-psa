#!/bin/bash
set -euo pipefail

# Repair secret-store modes and ownership for the filesystem secret provider.
#
# The provider requires the secret root and every directory under it to be mode
# 0700, every tenant secret file to be mode 0600, and every entry to be owned
# by the uid the application runs as, so writes are atomic, non-symlinked, and
# unreadable by other users regardless of umask. Installs that created these
# files under a permissive umask (typically 0755 dirs / 0644 files) or a
# different volume owner can run this once to bring the store in line. It is a
# one-time, non-destructive repair: it never deletes, rewrites, or reads
# secret contents, and never follows symlinks.
#
# Usage:
#   scripts/repair-secret-permissions.sh                       # dry-run: report only
#   scripts/repair-secret-permissions.sh --apply               # apply mode fixes
#   scripts/repair-secret-permissions.sh --apply --path /shared-tenant-secrets
#   sudo scripts/repair-secret-permissions.sh --apply --path /shared-tenant-secrets --uid 1000
#
# Modes:
#   (default)  Dry run. Report every directory/file whose mode is not the
#              expected 0700/0600 and every ownership mismatch, symlink, and
#              non-regular entry. Nothing is changed. Exits 0 only when the
#              store is already fully safe; exits 1 when anything needs fixing.
#   --apply    Apply the fixes: chmod 700 dirs / 600 files, and (as root with
#              --uid) chown every entry including the root to the target uid.
#              Repeats the walk until nothing more can be fixed, so directories
#              that were untraversable before their own repair are descended
#              into. Exits 0 only when the store ends fully safe; exits 1 when
#              any issue remains (symlinks, non-regular entries, or ownership
#              that needs root + --uid).
#   --path DIR  Secret store root to inspect (default: SECRET_FS_BASE_PATH,
#              else <repo>/secrets).
#   --uid N     Target owner uid. With --apply as root, chown mismatched
#              entries (including the root) to uid N. Without --uid, the
#              store root's current owner is treated as the expected owner.
#
# Symlinks and non-regular entries are never followed or changed; they are
# reported for manual intervention and keep the exit status non-zero.

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
      grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -44
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

if [ -n "$TARGET_UID" ]; then
  if [ "$APPLY" -eq 1 ] && [ "$RUNNING_UID" != "0" ]; then
    echo "❌ --uid requires running as root (current uid: $RUNNING_UID)." >&2
    exit 1
  fi
  TARGET_OWNER="$TARGET_UID"
else
  # Without --uid, the root's current owner is the reference owner: the
  # provider requires uniform ownership, so anything owned differently is a
  # problem even if the script cannot know the intended service uid.
  TARGET_OWNER="$(stat -c '%u' "$ROOT")"
fi

PASS_ISSUES=0
PASS_APPLIED=0

# Checks (and with --apply fixes) one entry's mode and owner. Mode and owner
# are handled independently: an entry with both a wrong mode and a wrong owner
# gets both a chmod and (as root with --uid) a chown in the same pass. Every
# unfixed problem — including ownership mismatches — counts as an issue so the
# script can never report a clean store, or exit 0, while the provider would
# still refuse writes.
check_entry() {
  local path="$1" kind="$2"
  local wanted mode uid
  if [ "$kind" = "dir" ]; then
    wanted=700
  else
    wanted=600
  fi

  mode="$(stat -c '%a' "$path")"
  uid="$(stat -c '%u' "$path")"

  if [ "$mode" != "$wanted" ]; then
    if [ "$APPLY" -eq 1 ] && { [ "$uid" = "$RUNNING_UID" ] || [ "$RUNNING_UID" = "0" ]; }; then
      chmod "$wanted" "$path"
      PASS_APPLIED=$((PASS_APPLIED + 1))
      echo "✅ Fixed $kind mode to $wanted: $path"
    elif [ "$APPLY" -eq 1 ]; then
      echo "⚠️  Not owned by you (uid $uid); cannot chmod: $path"
      PASS_ISSUES=$((PASS_ISSUES + 1))
    else
      echo "  $kind mode $mode (expected $wanted): $path"
      PASS_ISSUES=$((PASS_ISSUES + 1))
    fi
  fi

  if [ "$uid" != "$TARGET_OWNER" ]; then
    if [ "$APPLY" -eq 1 ] && [ "$RUNNING_UID" = "0" ] && [ -n "$TARGET_UID" ]; then
      chown "$TARGET_UID" "$path"
      PASS_APPLIED=$((PASS_APPLIED + 1))
      echo "✅ Fixed owner to uid $TARGET_UID: $path"
    else
      echo "⚠️  Owner mismatch: $path (uid $uid, expected uid $TARGET_OWNER; fixing needs root + --uid)"
      PASS_ISSUES=$((PASS_ISSUES + 1))
    fi
  fi
}

# One walk over the store: the root itself, then every entry below it. find is
# used with -P (never follow symlinks); each entry is classified by type so
# symlinks and non-regular entries are reported, not followed.
walk_store() {
  PASS_ISSUES=0
  PASS_APPLIED=0

  check_entry "$ROOT" dir

  while IFS= read -r entry; do
    if [ -L "$entry" ]; then
      echo "❌ Symlink (manual intervention required): $entry"
      PASS_ISSUES=$((PASS_ISSUES + 1))
    elif [ -d "$entry" ]; then
      check_entry "$entry" dir
    elif [ -f "$entry" ]; then
      check_entry "$entry" file
    else
      echo "❌ Non-regular entry (manual intervention required): $entry"
      PASS_ISSUES=$((PASS_ISSUES + 1))
    fi
  done < <(find -P "$ROOT" -mindepth 1 2>/dev/null)
}

if [ "$APPLY" -eq 1 ]; then
  echo "Applying fixes under $ROOT (dirs 0700, files 0600, owner uid $TARGET_OWNER)..."
  TOTAL_APPLIED=0
  PASSES=0
  # Repairing a directory can make previously-untraversable children visible
  # (find cannot descend into a dir it cannot read until its mode is fixed), so
  # repeat the walk until a pass fixes nothing more. The final pass's issue
  # count is authoritative.
  while :; do
    walk_store
    TOTAL_APPLIED=$((TOTAL_APPLIED + PASS_APPLIED))
    PASSES=$((PASSES + 1))
    if [ "$PASS_APPLIED" -eq 0 ] || [ "$PASSES" -ge 10 ]; then
      break
    fi
  done
  echo ""
  echo "✅ Applied $TOTAL_APPLIED fix(es)."
  if [ "$PASS_ISSUES" -gt 0 ]; then
    echo "⚠️  $PASS_ISSUES issue(s) remain — see above (symlinks and non-regular entries need manual intervention; ownership needs root + --uid). The store is NOT yet safe for secret writes."
    exit 1
  fi
  echo "✅ Store is safe: all directories 0700, all files 0600, owner uid $TARGET_OWNER."
else
  echo "Dry run under $ROOT — reporting only, no changes made. Re-run with --apply to fix."
  walk_store
  echo ""
  if [ "$PASS_ISSUES" -eq 0 ]; then
    echo "✅ Store is clean: all directories 0700, all files 0600, uniform owner uid $TARGET_OWNER."
  else
    echo "⚠️  $PASS_ISSUES issue(s) found. Re-run with --apply to fix modes (and ownership with root + --uid); review symlink items manually."
    exit 1
  fi
fi
