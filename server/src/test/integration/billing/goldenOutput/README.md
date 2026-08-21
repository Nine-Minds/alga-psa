# Golden-output baseline (F128 / T013)

The file `goldenOutputBaseline.integration.test.ts` is both the **F128
golden-output baseline harness** and the **T013 backward-compatibility gate**
(plan §4.1 step 0, §6.1). It runs a deterministic single-profile-client billing
scenario through the real engine and serializes a snapshot of the
money-relevant output — invoice totals, per-line amounts, tax figures, credit
application, the accounting-export preview including the customer/invoice
identity fields the export maps (invoice number, client id, client name — the
identity that must stay a plain, non-sub-customer for single-profile clients),
and the portal-visible output (the invoice list the client portal renders via
`fetchInvoicesByClient` and the rendering view model portal detail/PDF views
hydrate via `getInvoiceForRendering`) — then diffs it byte-for-byte against
the committed `baseline.json`.

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

## Provenance: the baseline comes from the pre-S1 tree, checkably

The committed `baseline.json` was **not** captured from the post-S1 tree. S1
(the schema + backfill) is already in this branch, so the honest baseline is
captured from the parent of the S1 commit — and that claim is **independently
re-derivable**, not self-attested:

- `baseline.provenance.json` records the pre-S1 commit SHA, its git tree hash,
  the SHA-256 of the committed `baseline.json`, and the capture command/env.
- `verify-baseline-provenance.sh` re-derives the baseline from scratch: it
  creates a temporary detached worktree at the recorded pre-S1 SHA, rebuilds
  `node_modules` so `@alga-psa/*` workspace packages resolve to the **pre-S1
  tree's own sources** (third-party deps shared from the main worktree),
  copies in the harness (the only capture-branch input — it is additive),
  runs the capture against the scratch test Postgres, and byte-diffs the
  result against the committed `baseline.json`. It also checks the manifest's
  hashes.

```bash
# Verify the committed baseline is exactly what the pre-S1 tree produces:
server/src/test/integration/billing/goldenOutput/verify-baseline-provenance.sh

# Re-capture (ONLY when the projection itself legitimately changes):
server/src/test/integration/billing/goldenOutput/verify-baseline-provenance.sh --capture
```

Because the harness file is the only capture-branch input, later slices must
keep it runnable against the pre-S1 tree: its imports must be restricted to
modules that exist at the recorded pre-S1 commit.

The pre-S1 tree's migrations build a schema with no `client_billing_profiles`
table, and the harness's fixture client therefore has no profile row — the
"single-profile client" state is represented by the absence of the table. On
the S1 tree the harness additionally inserts the one system-managed default
profile for the fixture client (mirroring the backfill) but serializes no
profile data, so both runs must produce byte-identical output. That identity is
the T013 proof for S1: the backfill alone perturbs nothing.
