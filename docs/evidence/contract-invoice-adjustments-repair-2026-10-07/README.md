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

The board's `workflow-ensure-service` accepts `--readinessPort` and `--readinessPath` even though `alga-dev --help` omits them. Re-ensuring registration `:19` with those arguments updated the durable record to `readiness:{port:3185,path:"/api/health"}` and returned `readinessUrl:"http://100.109.101.64:3185/api/health"`. A `workflow-restart-service` followed by command-free `workflow-ensure-service --name=dev-server` returned the saved command, worktree cwd, and readiness metadata with `created:false`; board policy then suspended the PTY because the current Draft Implementation step does not use the service. Under the explicitly authorized temporary Draft Implementation service-use permission, command-free ensure reached HTTP 200 on `/api/health`. After removing the temporary entry, normal policy suspended PTY `:19`; the reusable registration and readiness metadata remain saved. No service was concluded.

Normal board policy is restored: Draft Implementation has no `dev-server` dependency and Smoke Test retains it. The registration is durable and command-free resumable.

## Live smoke outcome

Authentication succeeded through the real MSP credentials form with a temporary least-privilege smoke user and role. The live Drafts UI saved a $150 manual charge, 10% manual discount, and later $1 charge against an owned invoice clone. Before-tax subtotal became $3,645.00 and then $3,645.90; reload and two repeat saves preserved six rows and no ledger postings. An app-generated PDF was captured and text-checked against persisted lines and totals. The owned invoice, generated PDF metadata, user, role, and session were cleaned up; shared invoice snapshots remained unchanged. Detailed evidence is in [authenticated current-HEAD evidence](authenticated-smoke-current-head/README.md).

Read-only database inspection confirmed the expected billing tables in the `server` schema and 1,127 Knex migration-ledger rows. No production-schema migration was applied. The isolated DB test used a fresh `test_contract_pr3499_20261007` database and that owned database was dropped after the run. The shared invoices below matched the before/after snapshots and were not touched:

| Invoice | ID | Status | Subtotal / total (minor units) | Revision | Charges |
| --- | --- | --- | ---: | ---: | ---: |
| `INV-000039` | `d8816325-32a7-4a58-b000-ff987b99f6fe` | draft | 390000 / 390000 | 0 | 3 |
| `REVIEW-CONTRACT-3499` | `5a1e0000-0000-4000-8000-202609279204` | draft | 405000 / 405000 | 20 | 4 |
| `SMOKE-ADJ-1` | `5a1e0000-0000-4000-8000-0000000000a1` | draft | 370500 / 371400 | 63 | 5 |

Current-HEAD smoke does not establish manual-line edit/removal, partial-period descriptions and permanent-change focus, actual QBO/Xero CSV downloads, delivered-export edit locks, prohibited lifecycle UI protections, or live provider acceptance. Historical evidence under `docs/evidence/contract-invoice-adjustments-repair-2026-09-27/` does not substitute for these current-HEAD paths.

## Database regression repair

The focused DB test that reconciles companion-ledger rows inserts valid rows into the already migrated `contract_recurring_unit_adjustments` schema and deletes only those fixture-owned rows. It does not drop or recreate the migration-owned table. The foreign-tenant row shares the same `revision_id` as the current tenant's source row while using its own tenant key and valid adjustment ID, preserving the tenant-isolation challenge under the schema's `(tenant, revision_id)` uniqueness constraint. Scope restoration is in a nested `finally`, so it still runs if fixture-row deletion fails. The focused test passed, then the full suite passed **63/63** on a fresh isolated DB with the migrated table present throughout; the complete output is [db-suite-2026-10-07-review-fix.log](db-suite-2026-10-07-review-fix.log).

The prior QBO/Xero three-versus-four classification failures were caused by test-order state leakage, not missing adapter output: the companion-ledger test changed the shared configured discount scope, then failed while trying to create the already-existing table before entering its `try/finally` restoration path. Later accounting matrix cases consequently serialized only three rows with discount classification. With insertion against the migrated table, cleanup executes and the configured discount scope is restored. QBO and Xero both pass the unchanged expectation of four classified lines and their signed-total parity assertions in the full 63-test run. Provider transport in the Xero case is mocked; this does not claim external accounting acceptance.

## Automated verification

- `packages/billing/src/lib/billing/compute/contractInvoiceAdjustments.test.ts`: **31/31 passed**.
- `npx nx run @alga-psa/billing:build`: passed from Nx cache (`existing outputs match the cache`).
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p packages/billing/tsconfig.json`: passed.
- `contractInvoiceAdjustments.db.test.ts`: **63/63 passed** after the migration-owned table fixture cleanup correction; see [db-suite-2026-10-07-review-fix.log](db-suite-2026-10-07-review-fix.log). The former QBO/Xero classification mismatch was caused by the failed setup bypassing the discount-scope cleanup; assertions remain at four and signed totals reconcile.

## Review first

Review the saved registration and command-free ensure response first, then inspect the focused test fix and full-suite log. The environment probe reached `/api/health` with HTTP 200 under temporary service-use permission, and normal board policy was restored afterward. Authenticated UI evidence now proves draft totals, repeat-save idempotency, no ledger postings, and generated PDF content. Actual accounting CSV downloads, UI lifecycle guards, partial-period descriptions/link focus, and live provider acceptance remain unverified. Do not treat environment recovery or automated evaluator coverage as whole-card acceptance. The companion card `f6e7254b` continues to own permanent quantity changes and automatic contract-change true-ups; this round added no duplicate mechanism.
