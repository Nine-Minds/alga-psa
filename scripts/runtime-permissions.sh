#!/bin/bash
set -euo pipefail

# One-shot ownership fix for the volumes and files the non-root application
# containers (uid 1000) need to read and write. Run it as root in a short-lived,
# capability-limited init container before the app services start:
#
#   user: "0:0"
#   cap_drop: [ALL]
#   cap_add: [CHOWN, FOWNER, DAC_OVERRIDE, SETUID, SETGID]
#
# SETUID/SETGID are only used by the final `setpriv` readability check, which
# runs as the target uid so the check matches what the app will experience.
#
# What it does (each step is idempotent and only touches entries that are not
# already correct, so a second run changes nothing):
#   1. FILES_DIR   (default /data/files)     chown everything to TARGET_UID:TARGET_GID.
#                                            Modes are left as they are.
#   2. TENANTS_DIR (default /data/tenants)   delegated to repair-secret-permissions.sh
#                                            (--apply --uid): owner uid, dirs 0700, files 0600.
#   3. SECRETS_DIR (default /host-secrets)   regular files directly inside it are chowned
#                                            to TARGET_UID:TARGET_GID with mode 0600, then
#                                            readability is verified as TARGET_UID.
#
# Symlinks are never followed or modified. Symlinks in SECRETS_DIR and FILES_DIR
# are reported and skipped. Directories that are not mounted are skipped.
#
# Environment overrides (mainly for tests):
#   TARGET_UID / TARGET_GID   default 1000
#   FILES_DIR, TENANTS_DIR, SECRETS_DIR
#   REPAIR_SCRIPT             default: repair-secret-permissions.sh next to this
#                             script, else /usr/local/bin/alga-repair-secret-permissions

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TARGET_UID="${TARGET_UID:-1000}"
TARGET_GID="${TARGET_GID:-1000}"
FILES_DIR="${FILES_DIR:-/data/files}"
TENANTS_DIR="${TENANTS_DIR:-/data/tenants}"
SECRETS_DIR="${SECRETS_DIR:-/host-secrets}"

if [ -n "${REPAIR_SCRIPT:-}" ]; then
  :
elif [ -x "$SCRIPT_DIR/repair-secret-permissions.sh" ]; then
  REPAIR_SCRIPT="$SCRIPT_DIR/repair-secret-permissions.sh"
else
  REPAIR_SCRIPT="/usr/local/bin/alga-repair-secret-permissions"
fi

log() {
  echo "[runtime-permissions] $*"
}

fail() {
  echo "[runtime-permissions] ❌ $*" >&2
  exit 1
}

if [ "$(id -u)" != "0" ]; then
  fail "must run as root (current uid: $(id -u)); it fixes ownership for uid $TARGET_UID."
fi

CHANGED=0

# --- 1. files volume ---------------------------------------------------------
if [ -L "$FILES_DIR" ]; then
  fail "$FILES_DIR is a symlink; refusing to touch it."
elif [ -d "$FILES_DIR" ]; then
  # -P: never follow symlinks. Symlinks are skipped (not chowned) so their
  # targets and the links themselves are left exactly as they were.
  count="$(find -P "$FILES_DIR" ! -type l \( ! -uid "$TARGET_UID" -o ! -gid "$TARGET_GID" \) -printf '.' | wc -c)"
  if [ "$count" -gt 0 ]; then
    find -P "$FILES_DIR" ! -type l \( ! -uid "$TARGET_UID" -o ! -gid "$TARGET_GID" \) \
      -exec chown -h "$TARGET_UID:$TARGET_GID" {} +
    log "✅ Fixed ownership of $count entr$([ "$count" = 1 ] && echo y || echo ies) under $FILES_DIR (now $TARGET_UID:$TARGET_GID)."
    CHANGED=$((CHANGED + count))
  else
    log "$FILES_DIR already owned by $TARGET_UID:$TARGET_GID."
  fi
else
  log "$FILES_DIR is not mounted; skipping."
fi

# --- 2. tenant secret store --------------------------------------------------
if [ -L "$TENANTS_DIR" ]; then
  fail "$TENANTS_DIR is a symlink; refusing to touch it."
elif [ -d "$TENANTS_DIR" ]; then
  [ -x "$REPAIR_SCRIPT" ] || fail "repair script not found or not executable: $REPAIR_SCRIPT"
  if ! tenant_output="$("$REPAIR_SCRIPT" --apply --path "$TENANTS_DIR" --uid "$TARGET_UID" 2>&1)"; then
    echo "$tenant_output" >&2
    fail "could not bring the tenant secret store $TENANTS_DIR into a safe state (see above). Remove or fix the reported entries on the host, then restart."
  fi
  if echo "$tenant_output" | grep -q 'Applied [1-9][0-9]* fix'; then
    log "✅ Repaired tenant secret store $TENANTS_DIR."
    CHANGED=$((CHANGED + 1))
  else
    log "Tenant secret store $TENANTS_DIR already correct."
  fi
else
  log "$TENANTS_DIR is not mounted; skipping."
fi

# --- 3. host app secrets -----------------------------------------------------
if [ -L "$SECRETS_DIR" ]; then
  fail "$SECRETS_DIR is a symlink; refusing to touch it."
elif [ -d "$SECRETS_DIR" ]; then
  # Depth 1 only: the tenant store is a subdirectory and is handled above.
  while IFS= read -r -d '' link; do
    log "⚠️  Skipping symlink (not followed): $link. Make sure its target is readable by uid $TARGET_UID."
  done < <(find -P "$SECRETS_DIR" -mindepth 1 -maxdepth 1 -type l -print0)

  count="$(find -P "$SECRETS_DIR" -mindepth 1 -maxdepth 1 -type f \( ! -uid "$TARGET_UID" -o ! -gid "$TARGET_GID" -o ! -perm 600 \) -printf '.' | wc -c)"
  if [ "$count" -gt 0 ]; then
    find -P "$SECRETS_DIR" -mindepth 1 -maxdepth 1 -type f \( ! -uid "$TARGET_UID" -o ! -gid "$TARGET_GID" \) \
      -exec chown -h "$TARGET_UID:$TARGET_GID" {} +
    find -P "$SECRETS_DIR" -mindepth 1 -maxdepth 1 -type f ! -perm 600 -exec chmod 0600 {} +
    log "✅ Fixed ownership/mode of $count secret file(s) under $SECRETS_DIR (now $TARGET_UID:$TARGET_GID, 0600)."
    CHANGED=$((CHANGED + count))
  else
    log "Secret files under $SECRETS_DIR already owned by $TARGET_UID:$TARGET_GID with mode 0600."
  fi

  # Verify as the target uid: the filesystem may refuse chown (some network and
  # desktop-virtualized mounts), and the app would otherwise start and fail with
  # a less obvious error.
  command -v setpriv >/dev/null 2>&1 || fail "setpriv not found; cannot verify that uid $TARGET_UID can read the secrets."
  unreadable=0
  while IFS= read -r -d '' secret; do
    if ! setpriv --reuid "$TARGET_UID" --regid "$TARGET_GID" --clear-groups \
        /bin/sh -c 'test -r "$1"' sh "$secret"; then
      echo "[runtime-permissions] ❌ Secret file is not readable by uid $TARGET_UID: $secret" >&2
      unreadable=$((unreadable + 1))
    fi
  done < <(find -P "$SECRETS_DIR" -mindepth 1 -maxdepth 1 -type f -print0)
  if [ "$unreadable" -gt 0 ]; then
    fail "$unreadable secret file(s) cannot be read by uid $TARGET_UID. Fix on the host: sudo chown $TARGET_UID:$TARGET_GID <file> && sudo chmod 600 <file> (or use a filesystem that supports chown)."
  fi
else
  log "$SECRETS_DIR is not mounted; skipping."
fi

log "Done ($CHANGED change(s))."
