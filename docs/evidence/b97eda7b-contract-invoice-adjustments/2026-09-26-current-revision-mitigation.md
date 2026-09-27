# Contract invoice adjustments — current revision mitigation

Card: `b97eda7b-0e3f-4b09-be80-6b57f934d8a5`  
Run: 2026-09-26, approximately 19:29–20:05 America/New_York
Worktree: `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc`  
Host: `robert-X670E-Pro-RS` (`100.109.101.64`)  
Target URL: `http://localhost:3185`  
Starting feature revision: `4ec7f6f040c2feb6e7a44ab1750088c0fcf7ade3`; evidence commit includes this report and screenshots.

## Outcome

The board-managed `dev-server` is now used by the active **Smoke Test** card step. Its saved definition runs this worktree's `server` directory on port 3185. Readiness is configured for `/api/health`; `workflow-ensure-service --name=dev-server` succeeds with no inline command, the HTTP check returns 200, and the supervised process cwd resolves to this worktree. This addresses the original infrastructure failure. The card browser route still returns `Session with given id not found`; local Playwright/Chrome was used against 3185.

The current-revision browser/database run verified manual adjustment add/edit/reload/remove, automatic discount recalculation and stable repeat-save amounts, generated-line protection in the editor, and customer preview/PDF/database parity. The full requested run is **not complete**: contract-line save/reload/rejection/restoration and billed plus locked-after-cancellation browser rejection were not completed. No application defect was reproduced. Do not interpret the partial run as completion of PR smoke acceptance.

## Service and session

- Service: `dev-server`, registered through the board service lifecycle, worktree server directory, `HOST=0.0.0.0 PORT=3185 npm run dev`.
- Moved card to its existing Smoke Test step, which declares `dev-server` as a used service. This is the supported lifecycle policy that prevents Draft Implementation's auto-suspension; the service was not started outside board supervision.
- Added readiness port 3185 and path `/api/health` through `workflow-ensure-service`; then called `workflow-ensure-service --name=dev-server` without `--command`, which returned the saved registration successfully.
- `curl http://127.0.0.1:3185/api/health`: HTTP 200, `{"status":"ok","version":"1.0.0"}`. Process inspection showed cwd `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc/server`; it was serving the current checkout and descendant evidence revision, not `:23185`.
- Card browser pane `d9f5edc2-3855-45de-aecf-f7b0310d1f73` returned `Session with given id not found`. Local Playwright/Google Chrome authenticated at `http://localhost:3185` as the synthetic test user and remained on port 3185 for all captures. The auth state file is local-only and excluded from this commit.
- `server/.env.local` is ignored local config; `NEXTAUTH_URL` was set to `http://localhost:3185` for this browser session. DB and Redis remained pointed at the local test stack. No credentials are in the evidence.

## Schema and migration preflight

The initial Knex status output had five historical migration ledger entries whose source files are absent from this checkout. That output alone was not used to infer missing schema. Direct read-only inspection of the shared `server` database confirmed the needed contract line description/date/custom-rate columns, nonnegative custom-rate check, invoice charge adjustment source/period/manual-credit columns, and adjustment source unique partial index plus period index. Required schema was already present, so no migration or ledger mutation was performed. The configured stack ports are PgBouncer 6472, Postgres 5472, and Redis 6419.

## Current-revision runtime results

Fixture: synthetic `SMOKE-ADJ-1`, invoice `5a1e0000-0000-4000-8000-0000000000a1`, Mountain Dental, tenant `6d178771-ad9a-4d43-8809-83992745f8f9`. The initial DB snapshot is retained at `/tmp/alga-smoke-evidence/contract-invoice-adjustments-20260926-2325/current/fixture-before.json`; it records persisted invoice totals of subtotal 361500 cents, tax 900 cents, total 362400 cents, revision 40, four charge rows, configured 10% discount, tax metadata on the manual taxable line, and the operation ledger.

- Draft entry point: opened Invoicing → Drafts, searched `SMOKE-ADJ-1`, selected the row, and reached Invoice adjustments. The invoice was not on the initially visible page; filtering was needed because the table paginates 10 rows. Screenshots: `current-revision-2026-09-26/current-draft-search.png`, `current-draft-selected.png`.
- Manual adjustment: added a temporary taxable manual charge (quantity 2, rate $10, Florida 6% tax), confirmed the persisted row and tax ($1.20), and observed the generated recurring charge remain $3,900 and read-only. Editing it to $12 and reloading preserved its description and Florida tax selection. Removing it removed the temporary row. Screenshots capture added, edited, reloaded, and removed states.
- Discount recalculation: adding the $20 manual net charge recalculated the configured 10% discount from $405 to $407 in the database while preserving the intentional existing manual credit, manual partial-period line, and manual tax metadata. Removing the temporary charge returned discount to $405. There was one automatic discount source row throughout.
- Repeat save: saved unchanged adjustments twice and reloaded. The persisted amount/charge set and automatic discount remained stable. Each save records an operation revision; temporary operation rows and invoice revision were restored to captured baseline after verification.
- Customer preview/PDF/DB parity after reload: preview showed subtotal `$3,615.00`, tax `$9.00`, total `$3,624.00`; generated PDF extracted to the same values. Persisted invoice rows were subtotal 361500, tax 900, total 362400 cents. Artifacts: `current-revision-2026-09-26/current-preview.png` and `current-customer-invoice.pdf`.
- Snapshot restoration: temporary charge was removed. Invoice charge rows and totals matched the before snapshot; revision was restored to 40 and the adjustment-operation ledger to the captured 40 rows. No unrelated fixture was intentionally mutated.

## Automated database checks

Command from `server/`, with the local env loaded and DB port 5472:

```sh
npx vitest run src/test/infrastructure/billing/contracts/contractLineProtectedHistory.test.ts --coverage.enabled=false
```

Result: **1 file passed, 4 tests passed**. These real-action DB tests cover billed claims, linked invoice/detail relationships, rejection without persisted line date/text changes, protected period boundaries, and safe/rejected bound clearing. They do **not** cover locked claims after invoice cancellation. Vitest also loaded `.env.localtest`; these are isolated test-harness results, not assertions against the shared server database.

## Not verified in this run

- Live contract-line description/date save, reload, re-edit, and restoration; rejection for billed and locked-after-cancellation claim bounds; released invoice linkage after cancellation; and clearing a line bound while retaining all protected periods.
- Automatic discount repeat-save operation/audit behavior beyond stable persisted amount and single source row.
- Client portal and live accounting export. Neither is claimed.
- Repository build/typecheck were not run because this run made no application source changes; the focused protected-history DB suite was run. The first attempted Playwright contract-line navigation stalled before mutation, so no line test result is claimed.

## Reviewer first check

Inspect this report's supervised service and current revision evidence first, then the preview/PDF and manual charge captures. Before accepting PR #3499, complete the outstanding contract-line and locked-after-cancellation browser/database cases against the same current revision, restoring their fixtures afterward. The missing cases are incomplete mitigation evidence, not a reproduced product defect. Separate feature limitations documented in the approved plan from these unverified smoke assertions.
