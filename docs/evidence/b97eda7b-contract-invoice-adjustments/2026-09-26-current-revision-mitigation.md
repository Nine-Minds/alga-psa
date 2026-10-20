# Contract invoice adjustments — current revision mitigation

Card: `b97eda7b-0e3f-4b09-be80-6b57f934d8a5`  
Runs: 2026-09-26, approximately 19:29–20:17 America/New_York; locked-cancellation follow-up on 2026-09-27 UTC
Worktree: `/home/robert/alga-copies/feature-contract-invoices-automatic-adjustments-and-disc`  
Host: `robert-X670E-Pro-RS` (`100.109.101.64`)  
Target URL: `http://localhost:3185`  
Starting feature revision: `4ec7f6f040c2feb6e7a44ab1750088c0fcf7ade3`; evidence commit includes this report and screenshots.

## Outcome

The board-managed `dev-server` is now used by the active **Smoke Test** card step. Its saved definition runs this worktree's `server` directory on port 3185. Readiness is configured for `/api/health`; `workflow-ensure-service --name=dev-server` succeeds with no inline command, the HTTP check returns 200, and the supervised process cwd resolves to this worktree. This addresses the original infrastructure failure. The card browser route still returns `Session with given id not found`; local Playwright/Chrome was used against 3185.

The current-revision browser/database run verified billed and locked-after-cancellation contract-line protections, manual adjustment add/edit/reload/remove, automatic discount recalculation and stable repeat-save amounts, generated-line protection in the editor, and customer preview/PDF/database parity. A dedicated synthetic draft invoice was reversed through the live UI. Its claim stayed locked with invoice/charge/detail linkage cleared; the live line editor rejected bounds that excluded the period, and DB snapshots confirmed no line fields changed. The safe edit path also saved and reloaded. No application defect was reproduced.

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
- Billed claim guard: on Red Rock Diner / MSP Standard line `30124f07-dca4-429c-8eee-489374d8415a`, with a billed claim for June 1–July 1, 2026 and canonical invoice detail linkage, a safe description and May 1, 2027 end date saved and survived navigation/reopen. June 2 start and June 30 end were rejected with boundary-specific messages; reload and SQL verified the stored values did not change. Clearing description/start/end saved and reloaded empty, and SQL verified original null values were restored. Captures are `09-contract-line-edit.png` and `20`–`24` in the evidence directory; interaction log is `protected.log`.
- Locked-after-cancellation claim guard: created a separate synthetic invoice `LOCKED-CANCEL-20260927` and contract line, with a June 1–July 1 recurring claim linked to the invoice, charge, and canonical detail. In Drafts, used **Reverse Draft** and confirmed through the production UI action (`hardDeleteInvoice`). The invoice and its charge/detail rows were deleted; DB snapshot `locked-cancel-2026-09-27/after-cancellation.json` shows the claim remained `locked` and `invoice_id`, `invoice_charge_id`, `invoice_charge_detail_id`, and `invoice_linked_at` became null. On that line, description plus a future end-date save survived editor reload. Start date June 2 was rejected with `Start date must be on or before 2026-06-01 to include protected service history.` End date June 30 was rejected with `End date must be on or after 2026-07-01 to include protected service history.` Each rejection was followed by reopening the editor and a direct DB snapshot; the original safe description and future end date remained persisted. The original description and null bounds were then restored. Screenshots and sanitized DB states are under `locked-cancel-2026-09-27/`.
- Customer preview/PDF/DB parity after reload: preview showed subtotal `$3,615.00`, tax `$9.00`, total `$3,624.00`; generated PDF extracted to the same values. Persisted invoice rows were subtotal 361500, tax 900, total 362400 cents. Artifacts: `current-revision-2026-09-26/current-preview.png` and `current-customer-invoice.pdf`.
- Snapshot restoration: temporary adjustment runs used two different captured states. The earlier focused run's `fixture-before.json` had invoice revision 40 and 40 operation rows; that run restored revision 40 and those 40 rows. The separate full Smoke Test run's committed `invoice-restored-db.json` had the same original four charge rows and $3,615/$9/$3,624 totals but invoice revision 51 after its UI saves. The shared DB was subsequently restored by the focused run to revision 40/40 operation rows; the two reports describe separate run snapshots, not one continuous revision claim. This locked-cancellation follow-up observed and left that current 40/40 state unchanged. It used only a new synthetic fixture, restored the line to its original text/null bounds, then deleted its claim, line, service configuration, assignment, and contract. `cleanup.json` shows zero remaining fixture rows; `audit-after.json` records the filtered audit query. No pre-existing invoice or contract rows were changed during this follow-up.

## Automated database checks

Command from `server/`, with the local env loaded and DB port 5472:

```sh
npx vitest run src/test/infrastructure/billing/contracts/contractLineProtectedHistory.test.ts --coverage.enabled=false
```

Result: **1 file passed, 5 tests passed**. The new real-action DB test seeds an invoice, recurring claim, charge, and canonical detail; calls `hardDeleteInvoice`; asserts the claim remains locked and all invoice linkage fields are cleared; then invokes `updateContractLine` to assert excluded start/end bounds reject without persistence while a safe description/future end edit and subsequent bound clear succeed. TestContext rolls back its isolated fixture. Vitest also loaded `.env.localtest`; these tests are isolated harness results, not assertions against the shared server database.

Build/checks: `npm -w @alga-psa/billing run build` passed (`tsup`, ESM build success). The full server typecheck passed with `NODE_OPTIONS=--max-old-space-size=16384 npm run typecheck` from `server/` (exit 0). Earlier attempts at default and 8 GB heaps exhausted memory; the billing-package-only typecheck at 4 GB also exhausted memory. The successful full server check is the applicable final typecheck result.

## Not verified in this run

- Automatic discount repeat-save operation/audit behavior beyond stable persisted amount and single source row.
- Client portal and live accounting export. Neither is claimed.
- No client portal or live accounting export result is claimed.

## Reviewer first check

Inspect this report's locked cancellation flow, post-cancellation claim/linkage DB snapshot, rejection screenshots, and `contractLineProtectedHistory.test.ts` transition test first. The dedicated synthetic fixture was cleaned up and no pre-existing fixture was modified in that follow-up. Build, full server typecheck, and focused behavioral DB test passed. Automatic mid-period true-ups remain an existing feature limitation under the approved next-period-only companion policy, separate from mitigation verification.
