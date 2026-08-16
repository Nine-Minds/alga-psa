# Golden-output baseline (F128 / T013)

The file `goldenOutputBaseline.integration.test.ts` is both the **F128
golden-output baseline harness** and the **T013 backward-compatibility gate**
(plan §4.1 step 0, §6.1). It runs a deterministic single-profile-client billing
scenario through the real engine and serializes a snapshot of the
money-relevant output — invoice totals, per-line amounts, tax figures, credit
application, and the accounting-export preview — then diffs it byte-for-byte
against the committed `baseline.json`.

**A diff is a defect, never a baseline to refresh.** If a slice genuinely must
change single-profile output, that is a scope change requiring an explicit
decision recorded in `SCRATCHPAD.md` before the baseline moves.

## Running

From `server/`:

```bash
# Diff mode (the gate):
env DB_HOST=127.0.0.1 DB_PORT=5472 DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=... \
  DB_USER_SERVER=app_user DB_PASSWORD_SERVER=... \
  npx vitest run src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts

# Capture mode (regenerate the committed baseline):
GOLDEN_CAPTURE=1 env DB_HOST=... npx vitest run src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts
```

On a mismatch the harness writes `baseline.actual.json` next to the committed
fixture for inspection.

## Capturing the pre-S1 baseline

The committed `baseline.json` was **not** captured from the post-S1 tree. S1
(the schema + backfill) is already in this branch, so the honest baseline was
captured by running this same harness against the parent of the S1 commit in a
temporary worktree:

```bash
git worktree add /tmp/pres1 <parent-of-S1>
cd /tmp/pres1/server
# (symlink node_modules/.env from the main worktree as needed)
GOLDEN_CAPTURE=1 npx vitest run src/test/integration/billing/goldenOutput/goldenOutputBaseline.integration.test.ts
```

The pre-S1 tree's migrations build a schema with no `client_billing_profiles`
table, and the harness's fixture client therefore has no profile row — the
"single-profile client" state is represented by the absence of the table. On
the S1 tree the harness additionally inserts the one system-managed default
profile for the fixture client (mirroring the backfill) but serializes no
profile data, so both runs must produce byte-identical output. That identity is
the T013 proof for S1: the backfill alone perturbs nothing.
