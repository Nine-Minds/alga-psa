#!/usr/bin/env bash
# F128 / T013 — golden baseline provenance harness.
#
# Independently re-derives `baseline.json` from the PRE-S1 tree recorded in
# `baseline.provenance.json` and byte-diffs it against the committed fixture,
# so "the baseline was captured before S1" is a checkable property instead of
# a commit-message claim.
#
# How the pre-S1 run is constructed (also recorded in the manifest):
#   * A temporary detached `git worktree` is created at `pre_s1_commit`.
#   * Workspace packages (@alga-psa/*) resolve to the PRE-S1 worktree's own
#     packages/ — the root node_modules is rebuilt as a symlink farm where
#     third-party entries point at the main worktree's node_modules but every
#     @alga-psa relative symlink is recreated locally, resolving inside the
#     pre-S1 tree. Engine sources, test-utils, vitest config, and the
#     migration set (hence the schema) are all pre-S1.
#   * The ONLY capture-branch input is the harness test file itself, copied
#     into the worktree (it is additive; it did not exist pre-S1).
#   * The scenario runs against the scratch test Postgres (127.0.0.1:5472 by
#     default); createTestDbConnection drops/recreates test_database and runs
#     the pre-S1 migrations.
#
# Usage:
#   ./verify-baseline-provenance.sh            # verify committed baseline.json
#   ./verify-baseline-provenance.sh --capture  # re-capture baseline.json from
#                                              # the pre-S1 tree + update the
#                                              # manifest's baseline_sha256
set -euo pipefail

GOLDEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$GOLDEN_DIR/baseline.provenance.json"
BASELINE="$GOLDEN_DIR/baseline.json"
HARNESS="goldenOutputBaseline.integration.test.ts"
REL_GOLDEN="src/test/integration/billing/goldenOutput"
REPO_ROOT="$(git -C "$GOLDEN_DIR" rev-parse --show-toplevel)"

MODE=verify
[[ "${1:-}" == "--capture" ]] && MODE=capture

[[ -f "$MANIFEST" ]] || { echo "FATAL: missing manifest $MANIFEST" >&2; exit 1; }

manifest_get() { python3 -c "import json,sys; print(json.load(open('$MANIFEST'))['$1'])"; }

PRE_S1_SHA="$(manifest_get pre_s1_commit)"
PRE_S1_TREE="$(manifest_get pre_s1_tree)"

ACTUAL_TREE="$(git -C "$REPO_ROOT" rev-parse "${PRE_S1_SHA}^{tree}")"
if [[ "$ACTUAL_TREE" != "$PRE_S1_TREE" ]]; then
  echo "FATAL: tree hash of $PRE_S1_SHA is $ACTUAL_TREE, manifest says $PRE_S1_TREE" >&2
  exit 1
fi

# --- database env (scratch test Postgres; never the shared dev DB) ----------
export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5472}"
export DB_USER_ADMIN="${DB_USER_ADMIN:-postgres}"
export DB_USER_SERVER="${DB_USER_SERVER:-app_user}"
export DB_PASSWORD_ADMIN="${DB_PASSWORD_ADMIN:-$(cat "$REPO_ROOT/secrets/postgres_password")}"
export DB_PASSWORD_SERVER="${DB_PASSWORD_SERVER:-$(cat "$REPO_ROOT/secrets/db_password_server")}"
if [[ "$DB_PORT" == "6472" ]]; then
  echo "FATAL: refusing to run against port 6472 (shared dev Postgres)" >&2
  exit 1
fi

# --- pre-S1 worktree --------------------------------------------------------
TMP="$(mktemp -d /tmp/golden-pres1.XXXXXX)"
TREE="$TMP/tree"
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$TREE" >/dev/null 2>&1 || true
  git -C "$REPO_ROOT" worktree prune >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> creating pre-S1 worktree at $PRE_S1_SHA"
git -C "$REPO_ROOT" worktree add --detach "$TREE" "$PRE_S1_SHA" >/dev/null

echo "==> rebuilding node_modules (third-party shared, @alga-psa resolved pre-S1)"
mkdir "$TREE/node_modules"
find "$REPO_ROOT/node_modules" -mindepth 1 -maxdepth 1 \
  ! -name '@alga-psa' -exec ln -s {} "$TREE/node_modules/" \;
mkdir "$TREE/node_modules/@alga-psa"
for link in "$REPO_ROOT"/node_modules/@alga-psa/*; do
  name="$(basename "$link")"
  target="$(readlink "$link")" # relative, e.g. ../../packages/billing
  ln -s "$target" "$TREE/node_modules/@alga-psa/$name"
  if [[ ! -e "$TREE/node_modules/@alga-psa/$name" ]]; then
    # Package added after the pre-S1 commit; the harness must not need it.
    rm "$TREE/node_modules/@alga-psa/$name"
    echo "    (skipped @alga-psa/$name — absent in pre-S1 tree)"
  fi
done
ln -s "$REPO_ROOT/server/node_modules" "$TREE/server/node_modules"
ln -s "$REPO_ROOT/secrets" "$TREE/secrets"
# Env files that are tracked (e.g. .env.localtest) are already present in the
# checkout; only link untracked ones the main worktree carries.
for envfile in .env .env.localtest; do
  if [[ -f "$REPO_ROOT/$envfile" && ! -e "$TREE/$envfile" ]]; then
    ln -s "$REPO_ROOT/$envfile" "$TREE/$envfile"
  fi
done

echo "==> copying harness (the only capture-branch input)"
mkdir -p "$TREE/server/$REL_GOLDEN"
cp "$GOLDEN_DIR/$HARNESS" "$TREE/server/$REL_GOLDEN/$HARNESS"

echo "==> running pre-S1 capture against $DB_HOST:$DB_PORT"
(
  cd "$TREE/server"
  GOLDEN_CAPTURE=1 npx vitest run "$REL_GOLDEN/$HARNESS"
)

PRODUCED="$TREE/server/$REL_GOLDEN/baseline.json"
[[ -f "$PRODUCED" ]] || { echo "FATAL: pre-S1 run produced no baseline.json" >&2; exit 1; }
PRODUCED_SHA="$(sha256sum "$PRODUCED" | cut -d' ' -f1)"

if [[ "$MODE" == "capture" ]]; then
  cp "$PRODUCED" "$BASELINE"
  python3 - "$MANIFEST" "$PRODUCED_SHA" <<'PY'
import json, sys
path, sha = sys.argv[1], sys.argv[2]
with open(path) as fh:
    manifest = json.load(fh)
manifest['baseline_sha256'] = sha
with open(path, 'w') as fh:
    json.dump(manifest, fh, indent=2)
    fh.write('\n')
PY
  echo "==> captured baseline.json from pre-S1 tree (sha256 $PRODUCED_SHA); manifest updated"
  exit 0
fi

# --- verify mode ------------------------------------------------------------
COMMITTED_SHA="$(sha256sum "$BASELINE" | cut -d' ' -f1)"
MANIFEST_SHA="$(manifest_get baseline_sha256)"
FAIL=0
if [[ "$COMMITTED_SHA" != "$MANIFEST_SHA" ]]; then
  echo "FAIL: committed baseline.json sha256 $COMMITTED_SHA != manifest baseline_sha256 $MANIFEST_SHA" >&2
  FAIL=1
fi
if ! cmp -s "$PRODUCED" "$BASELINE"; then
  cp "$PRODUCED" "$GOLDEN_DIR/baseline.pres1-rederived.json"
  echo "FAIL: pre-S1 re-derived output differs from committed baseline.json" >&2
  echo "      re-derived copy written to baseline.pres1-rederived.json" >&2
  diff <(head -c 2000 "$BASELINE") <(head -c 2000 "$PRODUCED") || true
  FAIL=1
fi
if [[ "$FAIL" == "0" ]]; then
  echo "OK: baseline.json byte-identical to a fresh pre-S1 ($PRE_S1_SHA) capture; sha256 $COMMITTED_SHA matches manifest"
fi
exit "$FAIL"
