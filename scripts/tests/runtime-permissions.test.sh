#!/usr/bin/env bash
#
# Tests for scripts/runtime-permissions.sh.
#
# The script chowns to uid 1000, so it has to run as root. When this test is
# started as a non-root user it re-runs itself inside a throwaway container
# that has exactly the capabilities the compose `runtime-permissions` service
# grants (CHOWN, FOWNER, DAC_OVERRIDE, SETUID, SETGID). Nothing outside a
# temporary sandbox directory is touched.
#
# Usage: scripts/tests/runtime-permissions.test.sh
#
# Environment:
#   RUNTIME_PERMISSIONS_TEST_IMAGE  image used for the container run (default
#                                   node:24-bookworm-slim; needs bash, find,
#                                   setpriv and python3-free coreutils)
#   ALGA_NO_NEW_PRIVILEGES          true (default) | false. Set false on
#                                   snap-installed Docker.
#   TMPDIR                          sandbox parent; Docker must be able to
#                                   bind-mount it (snap Docker cannot see /tmp
#                                   or hidden directories, so use a path under
#                                   $HOME there).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "$(id -u)" != "0" ]; then
  IMAGE="${RUNTIME_PERMISSIONS_TEST_IMAGE:-node:24-bookworm-slim}"
  NNP="${ALGA_NO_NEW_PRIVILEGES:-true}"
  exec docker run --rm \
    --user 0:0 \
    --cap-drop ALL \
    --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE --cap-add SETUID --cap-add SETGID \
    --security-opt "no-new-privileges:${NNP}" \
    -v "$REPO_ROOT/scripts:/scripts:ro" \
    --entrypoint /bin/bash \
    "$IMAGE" /scripts/tests/runtime-permissions.test.sh
fi

SCRIPT="$REPO_ROOT/scripts/runtime-permissions.sh"
[ -f "$SCRIPT" ] || SCRIPT=/scripts/runtime-permissions.sh

PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); echo "  ok - $1"; }
fail() { FAILED=$((FAILED + 1)); echo "  FAIL - $1"; }

assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi
}

meta() { stat -c '%u:%g %a' "$1"; }
# Everything that changes when chown/chmod touches an entry: owner, mode, ctime.
snapshot() { find -P "$1" -printf '%p %u:%g %m %C@\n' | sort; }

new_sandbox() {
  SB="$(mktemp -d)"
  mkdir -p "$SB/files/sub" "$SB/tenants/t1" "$SB/secrets"
  chmod 755 "$SB"
}

run_script() {
  FILES_DIR="$SB/files" TENANTS_DIR="$SB/tenants" SECRETS_DIR="$SB/secrets" \
    bash "$SCRIPT" 2>&1
}

echo "runtime-permissions: mixed ownership is repaired"
new_sandbox
echo data > "$SB/files/a.txt"; echo data > "$SB/files/sub/b.txt"
chown 0:0 "$SB/files" "$SB/files/sub" "$SB/files/a.txt"
chown 1000:1000 "$SB/files/sub/b.txt"
chmod 640 "$SB/files/a.txt"
echo s > "$SB/tenants/t1/secret"; chown 0:0 "$SB/tenants" "$SB/tenants/t1" "$SB/tenants/t1/secret"
chmod 755 "$SB/tenants" "$SB/tenants/t1"; chmod 644 "$SB/tenants/t1/secret"
echo pw > "$SB/secrets/db_password"; echo pw > "$SB/secrets/redis_password"
chown 1001:1001 "$SB/secrets/db_password"; chown 0:0 "$SB/secrets/redis_password"
chmod 444 "$SB/secrets/db_password"; chmod 600 "$SB/secrets/redis_password"

OUT="$(run_script)"; RC=$?
assert_eq "exit status 0" "$RC" "0"
assert_eq "files root owned by 1000" "$(meta "$SB/files")" "1000:1000 755"
assert_eq "file owner fixed, mode kept" "$(meta "$SB/files/a.txt")" "1000:1000 640"
assert_eq "nested dir owner fixed" "$(meta "$SB/files/sub")" "1000:1000 755"
assert_eq "tenant root 0700 owned by 1000" "$(meta "$SB/tenants")" "1000:0 700"
assert_eq "tenant dir 0700" "$(meta "$SB/tenants/t1")" "1000:0 700"
assert_eq "tenant file 0600" "$(meta "$SB/tenants/t1/secret")" "1000:0 600"
assert_eq "app secret 444 -> 1000 0600" "$(meta "$SB/secrets/db_password")" "1000:1000 600"
assert_eq "app secret root-owned -> 1000 0600" "$(meta "$SB/secrets/redis_password")" "1000:1000 600"
rm -rf "$SB"

echo "runtime-permissions: second run changes nothing"
new_sandbox
echo data > "$SB/files/a.txt"; echo s > "$SB/tenants/t1/secret"; echo pw > "$SB/secrets/db_password"
chown 0:0 "$SB/files/a.txt"; chmod 644 "$SB/tenants/t1/secret"
run_script >/dev/null
BEFORE="$(snapshot "$SB")"
OUT="$(run_script)"; RC=$?
AFTER="$(snapshot "$SB")"
assert_eq "second run exit status 0" "$RC" "0"
assert_eq "no owner, mode or ctime change" "$AFTER" "$BEFORE"
case "$OUT" in *"Done (0 change(s))"*) pass "reports zero changes" ;; *) fail "reports zero changes: $OUT" ;; esac
rm -rf "$SB"

echo "runtime-permissions: symlinks are not followed or modified"
new_sandbox
mkdir "$SB/outside"; echo x > "$SB/outside/target"; chown 0:0 "$SB/outside" "$SB/outside/target"; chmod 644 "$SB/outside/target"
ln -s "$SB/outside/target" "$SB/files/link-to-file"
ln -s "$SB/outside" "$SB/files/link-to-dir"
ln -s "$SB/outside/target" "$SB/secrets/linked_secret"
echo pw > "$SB/secrets/db_password"
LINK_BEFORE="$(stat -c '%n %u:%g %Z' "$SB/files/link-to-file" "$SB/files/link-to-dir" "$SB/secrets/linked_secret")"
OUT="$(run_script)"; RC=$?
LINK_AFTER="$(stat -c '%n %u:%g %Z' "$SB/files/link-to-file" "$SB/files/link-to-dir" "$SB/secrets/linked_secret")"
assert_eq "exit status 0" "$RC" "0"
assert_eq "link target owner/mode untouched" "$(meta "$SB/outside/target")" "0:0 644"
assert_eq "linked directory untouched" "$(stat -c '%u:%g' "$SB/outside")" "0:0"
assert_eq "links themselves untouched" "$LINK_AFTER" "$LINK_BEFORE"
case "$OUT" in *"linked_secret"*) pass "symlinked secret is reported" ;; *) fail "symlinked secret is reported: $OUT" ;; esac
rm -rf "$SB"

echo "runtime-permissions: symlinked tenant store is refused"
new_sandbox
rm -rf "$SB/tenants"; mkdir "$SB/real-tenants"; ln -s "$SB/real-tenants" "$SB/tenants"
OUT="$(run_script)"; RC=$?
assert_eq "non-zero exit" "$([ "$RC" != 0 ] && echo yes || echo no)" "yes"
assert_eq "real dir untouched" "$(stat -c '%u:%g %a' "$SB/real-tenants")" "0:0 755"
rm -rf "$SB"

echo "runtime-permissions: unreadable secret fails loudly and names the file"
new_sandbox
echo pw > "$SB/secrets/good_secret"
echo pw > "$SB/secrets/broken_secret"
# Make chown a no-op for this one file by shadowing chown with a wrapper that
# refuses it, the way a filesystem that rejects chown would.
mkdir "$SB/bin"
cat > "$SB/bin/chown" <<EOF
#!/bin/bash
for a in "\$@"; do
  case "\$a" in *broken_secret*) exit 0 ;; esac
done
exec /usr/bin/chown "\$@"
EOF
chmod +x "$SB/bin/chown"
chown 0:0 "$SB/secrets/broken_secret"; chmod 600 "$SB/secrets/broken_secret"
OUT="$(PATH="$SB/bin:$PATH" run_script)"; RC=$?
assert_eq "non-zero exit" "$([ "$RC" != 0 ] && echo yes || echo no)" "yes"
case "$OUT" in *"not readable by uid 1000: $SB/secrets/broken_secret"*) pass "names the unreadable file" ;; *) fail "names the unreadable file: $OUT" ;; esac
case "$OUT" in *"good_secret: "*) fail "good secret reported as unreadable" ;; *) pass "readable secret not reported" ;; esac
rm -rf "$SB"

echo "runtime-permissions: unmounted directories are skipped"
SB="$(mktemp -d)"
OUT="$(FILES_DIR="$SB/none1" TENANTS_DIR="$SB/none2" SECRETS_DIR="$SB/none3" bash "$SCRIPT" 2>&1)"; RC=$?
assert_eq "exit status 0" "$RC" "0"
rm -rf "$SB"

echo
echo "passed: $PASSED, failed: $FAILED"
[ "$FAILED" -eq 0 ]
