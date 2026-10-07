# Contract invoice adjustment service recovery — 2026-10-07

Worktree: `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc`
Branch: `feature/contract-invoices-automatic-adjustments-and-disc`
Baseline: `12cd331bba55a892440ccec6b844060ccf98f297`
PR: [#3499](https://github.com/Nine-Minds/alga-psa/pull/3499)

## Service recovery

The card inventory contained only concluded `dev-server` attempts. The saved successful command from prior registrations/evidence was restored through the board:

```text
cwd: /home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc/server
command: NODE_OPTIONS=--max-old-space-size=8192 HOST=0.0.0.0 PORT=3185 npm run dev:turbo
```

`workflow-ensure-service --name=dev-server` without a command returned `created:false` for the saved service after the definition was recreated. It relaunched the supervised PTY; dependency builds completed and the process started from this worktree. `http://127.0.0.1:3185/api/health` returned HTTP 200 with `{"status":"ok","version":"1.0.0"}`. The saved command and worktree cwd are in [service-registration-redacted.json](service-registration-redacted.json); [health-check.txt](health-check.txt) records the successful probe.

The current step initially suspended startup because `Draft Implementation` did not list `dev-server`. A temporary service-use entry was applied through the board template updater, then removed after readiness was reached. `Smoke Test` retains the `dev-server` service-use entry. With Draft's policy restored, the board suspended PTY `:19` with reason `"Draft Implementation" does not use it`; the reusable service registration remains saved. No service was concluded and no unmanaged server was started.

The board's `workflow-ensure-service` accepts `--readinessPort` and `--readinessPath` even though `alga-dev --help` omits them. Re-ensuring registration `:19` with those arguments updated the durable record to `readiness:{port:3185,path:"/api/health"}` and returned `readinessUrl:"http://100.109.101.64:3185/api/health"`. A `workflow-restart-service` followed by command-free `workflow-ensure-service --name=dev-server` returned the saved command, worktree cwd, and readiness metadata with `created:false`; board policy then suspended the PTY because the current Draft Implementation step does not use the service. The command-free resume therefore proves saved-definition recovery but did not reach HTTP readiness while that policy was active. Earlier, while the temporary service-use permission was active, the worktree returned HTTP 200 from `/api/health`; after restoring policy, direct curl correctly found the process suspended. No service was concluded.

The normal board template policy was restored after this probe: Draft Implementation has no `dev-server` dependency, and Smoke Test retains it. This is a board-policy lifecycle result, not a product registration failure. The durable registration is reusable and readiness-configured; the live smoke still requires execution from the authorized Smoke Test step (or equivalent board policy activation).

## Live smoke outcome

The smoke was blocked at authentication after the server became healthy. The current service did not capture a generated login password, and the password facts on concluded registrations were stale; the shared development login rejected them. No shared credential was reset. The current browser displayed the sign-in page and `Invalid email or password`. No invoice was opened or mutated, no smoke fixture was created, no export/PDF was downloaded, and no accounting provider or simulator was exercised. A valid existing session or isolated smoke user through the real authentication path remains necessary.

Read-only database inspection confirmed the expected billing tables in the `server` schema and 1,127 Knex migration-ledger rows. No production-schema migration was applied. The isolated DB test used a fresh `test_contract_pr3499_20261007` database and that owned database was dropped after the run. The shared invoices below matched the before/after snapshots and were not touched:

| Invoice | ID | Status | Subtotal / total (minor units) | Revision | Charges |
| --- | --- | --- | ---: | ---: | ---: |
| `INV-000039` | `d8816325-32a7-4a58-b000-ff987b99f6fe` | draft | 390000 / 390000 | 0 | 3 |
| `REVIEW-CONTRACT-3499` | `5a1e0000-0000-4000-8000-202609279204` | draft | 405000 / 405000 | 20 | 4 |
| `SMOKE-ADJ-1` | `5a1e0000-0000-4000-8000-0000000000a1` | draft | 370500 / 371400 | 63 | 5 |

The current UI paths, totals, line editing/removal, preview/PDF parity, partial-period links and descriptions, accounting CSV downloads, delivered-export locks and prohibited lifecycle states remain unverified in this round. Prior evidence under `docs/evidence/contract-invoice-adjustments-repair-2026-09-27/` is historical and does not substitute for current-HEAD live smoke.

## Database regression repair

The focused DB test that reconciles companion-ledger rows now inserts valid rows into the already migrated `contract_recurring_unit_adjustments` schema instead of creating a three-column shadow table. Its full-column fixture includes the required period, quantity, rate, amount, status-defaulted, and identity fields. This avoids the reported duplicate-table failure and exercises the real migrated relation. The focused test passed, then the full suite passed **63/63** on a fresh isolated DB; the complete output is [db-suite-2026-10-07.log](db-suite-2026-10-07.log).

The prior QBO/Xero three-versus-four classification failures were caused by test-order state leakage, not missing adapter output: the companion-ledger test changed the shared configured discount scope, then failed while trying to create the already-existing table before entering its `try/finally` restoration path. Later accounting matrix cases consequently serialized only three rows with discount classification. With insertion against the migrated table, cleanup executes and the configured discount scope is restored. QBO and Xero both pass the unchanged expectation of four classified lines and their signed-total parity assertions in the full 63-test run. Provider transport in the Xero case is mocked; this does not claim external accounting acceptance.

## Automated verification

- `packages/billing/src/lib/billing/compute/contractInvoiceAdjustments.test.ts`: **31/31 passed**.
- `npx nx run @alga-psa/billing:build`: passed from Nx cache (`existing outputs match the cache`).
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p packages/billing/tsconfig.json`: passed.
- `contractInvoiceAdjustments.db.test.ts`: two runs produced variable failures. The first reported 50/63 passing (13 failures; its captured tool output was truncated). The rerun reported **60/63 passing**. The three reproducible rerun failures were: a test attempts to create `contract_recurring_unit_adjustments` although the migrated test DB already has it, and QBO/Xero accounting-export matrix assertions expected four classified lines but received three. These are test/schema or export behavior findings separate from the board registration failure; no billing source change was made. Full rerun summary: `/tmp/contract-invoice-dbtest.log` (local, not committed).

## Review first

Review the saved registration and command-free ensure response first, then inspect the focused test fix and full-suite log. The environment probe reached `/api/health` with HTTP 200 under temporary service-use permission, and normal board policy was restored afterward. The current browser smoke still needs a valid existing session or isolated, properly permissioned smoke user; do not reset shared credentials. PDF/UI flows, actual CSV downloads, invoice ledger/idempotency outcomes, and lifecycle states remain unverified. Do not treat environment recovery or automated evaluator coverage as whole-card acceptance. The companion card `f6e7254b` continues to own permanent quantity changes and automatic contract-change true-ups; this round added no duplicate mechanism.
