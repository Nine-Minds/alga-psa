# Billing Credits Reconciliation — Resurrection Plan

**Branch:** `feature/billing-credits-reconciliation`
**Date:** 2026-07-26

## Background

A full credit-reconciliation subsystem was built (~Feb 2025) and then abandoned before its
operator-facing surface shipped. Today:

- **Alive and running:** detection engine (`packages/billing/src/actions/creditReconciliationActions.ts`),
  fix actions (`creditReconciliationFixActions.ts`), `credit_reconciliation_reports` table + model,
  a nightly `credit-reconciliation` job (2 AM, registered in `server/src/lib/jobs/index.ts`), and REST
  endpoints `POST /api/v1/financial/reconciliation/run` and `POST /api/v1/financial/reconciliation/[id]/resolve`.
  Reports are being generated nightly into a table no screen displays.
- **Orphaned (imported by nothing, no routes):** `CreditReconciliation.tsx` (657 lines),
  `DiscrepancyDetail.tsx`, `ReconciliationResolution.tsx`, `RecommendedFixPanel.tsx`, and
  `CreditManagement.tsx` under `packages/billing/src/components/billing-dashboard/`.
- **Abandonment scars:** components call a never-created `/api/reconciliation-reports/{id}` route;
  `fetchClientsForDropdown` in `packages/reporting/src/actions/reconciliationReportActions.ts` returns
  mock clients; the trend chart uses static mock months; `server/src/lib/utils/creditReconciliationUtils.ts`
  is dead legacy; `reconciliationListQuerySchema` is imported into `ApiFinancialController` with no
  handler; a `credit:reconcile` permission is seeded but actions check `billing:read`/`billing:update`.

The detection actions already use `client_id` (they survived the company→client rename), so this is a
resurrection, not a rewrite.

## Decisions (settled in design session)

1. **Validate the detection logic first** — integration tests per discrepancy type and fix action, plus a
   seeded end-to-end run against the dev stack DB. Validation gates the UI work.
2. **UI placement:** a new **Reconciliation tab on the existing `/msp/billing/credits` page**, following
   that page's `CreditsTabs` conventions. Drill-down (discrepancy detail / resolution) presented within
   the tab (drawer or sub-view), not a separate route tree.
3. **Full resolve workflow:** operators can view discrepancies, apply the recommended automated fixes
   (correcting transactions / tracking-entry repairs), apply custom adjustments, and mark-resolved with notes.
4. **Finish the public REST API:** add GET list + GET by-id reconciliation-report handlers behind the
   already-imported schemas, with OpenAPI entries. UI itself uses server actions, not REST.
5. **Credit-side hardening is in scope.** The credits page's "Add Credit" button is a stub (placeholder
   dialog, `console.log` submit); the public `POST /api/v1/invoices/{id}/credit` path
   (`InvoiceService.applyCredit`) writes to a phantom `invoice_credits` table no migration creates; and
   there are three parallel apply-credit implementations. This branch fixes drift at the source, not just
   its detection.
6. **Async processes run in Temporal for hosted and appliance (EE):** the nightly job is already wired
   there — `ee/temporal-workflows/src/schedules/setupSchedules.ts` schedules `credit-reconciliation`
   (2 AM) via `maintenanceJobWorkflow`, fanning out per-tenant through
   `packages/jobs/src/lib/maintenanceJobFanout.ts` → `creditReconciliationHandler`; CE keeps the pg-boss
   cron. This branch validates that Temporal path and keeps every new async entry point on the same
   split (Temporal on EE, pg-boss on CE), never scheduling ad-hoc pg-boss work on EE.

## Phase 1 — Validate the detection & fix engine (gate)

Scope: `creditReconciliationActions.ts`, `creditReconciliationFixActions.ts`,
`models/creditReconciliationReport.ts`, `packages/jobs/src/lib/handlers/creditReconciliationHandler.ts`.

1. **Code audit** of each validator against the current schema and transaction semantics:
   - `validateCreditBalanceWithoutCorrection` (client `credit_balance` vs. transaction ledger)
   - `validateCreditTrackingEntries` (missing tracking entries for credit-issuance transactions)
   - `validateCreditTrackingRemainingAmounts` (tracking `remaining_amount` vs. allocations)
   - `runScheduledCreditBalanceValidation` (the nightly job path)
   Confirm tenant scoping (CitusDB), transaction boundaries, and interaction with credit expiration.
2. **Integration tests** (per `integration-testing` skill conventions) covering, for each discrepancy type:
   seeded discrepancy → detector produces a correct open report (expected vs. actual amounts, metadata);
   re-run does not duplicate open reports; clean data produces no report.
3. **Fix-action tests:** `createMissingCreditTrackingEntry`, `updateCreditTrackingRemainingAmount`,
   `applyCustomCreditAdjustment`, `markReportAsResolvedNoAction` — each resolves its report, writes the
   correcting transaction/tracking mutation, restores balance consistency (detector re-run finds nothing),
   and is audit-logged.
4. **Seeded live run:** seed known discrepancies of each type into the dev stack DB, trigger the job
   handler (and the REST `run` endpoint), and verify reports end-to-end; then apply fixes and verify closure.
   Exercise the scheduled entry point on both rails: the EE Temporal `maintenance-fanout:credit-reconciliation`
   schedule (via `maintenanceJobWorkflow` → `maintenanceJobFanout`) and the CE pg-boss cron — confirming
   per-tenant fanout, overlap=SKIP behavior, and identical results from either path.
5. **Fix what the audit finds.** Any defects in detection/fix logic are corrected in this phase, with tests.

Exit criterion: all discrepancy types detected and fixed correctly in tests and in the seeded live run.

## Phase 2 — Data layer and API

1. **Server actions for the UI.** Replace the components' phantom REST fetches with server actions:
   list reports (filter by client, status, type; paginate), get report detail with client/transaction
   context, stats/summary for the dashboard header, and the existing resolve/fix actions. Rework
   `packages/reporting/src/actions/reconciliationReportActions.ts` — real `fetchClientsForDropdown`
   (or reuse the existing client-picker action the credits page uses), no mocks.
2. **REST completion in `ApiFinancialController` / `FinancialService`:**
   - `GET /api/v1/financial/reconciliation` (list, backed by `reconciliationListQuerySchema`)
   - `GET /api/v1/financial/reconciliation/[id]`
   - OpenAPI route entries alongside the existing run/resolve docs.
3. **Permissions:** standardize on the `billing` resource (`billing:read` to view, `billing:update` to
   resolve/fix), matching what the actions already enforce; remove or alias the orphan `credit:reconcile`
   seed so there is one truth. All new actions/routes enforce the same checks.

## Phase 3 — Credit-side hardening (attack drift at the source)

1. **One canonical apply-credit path.** `packages/billing/src/actions/creditActions.applyCreditToInvoice`
   is the single engine (ledger: `credit_allocations`, `transactions`, `credit_tracking`,
   `clients.credit_balance`, QBO enqueue). Rewire:
   - `FinancialService.applyCreditToInvoice` (backs `POST /financial/credits/apply`) to delegate to the
     canonical action instead of re-implementing the ledger writes.
   - `InvoiceService.applyCredit` (backs `POST /invoices/{id}/credit` and the bulk variant) to delegate
     likewise; delete all `invoice_credits` phantom-table code paths (the table has no migration).
   Preserve each endpoint's request/response contracts; integration tests prove both REST paths and the
   UI path produce identical ledger state for the same input.
2. **Implement the "Add Credit" flow on the credits page.** Replace the placeholder dialog in
   `packages/billing/src/components/credits/AddCreditButton.tsx` with a real form (client, amount,
   optional expiration override, notes) backed by the existing prepayment/credit-issuance actions
   (`creditActions.createPrepaymentInvoice` flow), respecting `billing:update` permissions and house
   dialog/form idioms.
3. **Regression proof:** after consolidation, re-run the Phase 1 detector suite — applying credits via
   every entry point must produce zero discrepancies.

## Phase 4 — Resurrect the dashboard as a Credits tab

1. Add a **Reconciliation** tab to `/msp/billing/credits` (`CreditsTabs` gains a `reconciliation` id;
   tab param already round-trips through the URL).
2. Migrate the orphaned components out of `billing-dashboard/` into
   `packages/billing/src/components/credits/reconciliation/`, reworked to current house idioms
   (server actions, current UI kit components, `id` attributes per coding standards, i18n keys that
   already exist under `msp/credits.json`):
   - **Overview:** open-discrepancy table (client, type, expected vs. actual, detected date, status),
     summary stats, filters. Real trend data (reports opened/resolved per month from the table) —
     no mock months; if trend adds no value initially, cut it rather than fake it.
   - **Detail:** discrepancy drill-down with transaction context and the recommended fix
     (`RecommendedFixPanel` logic).
   - **Resolution:** apply recommended fix, apply custom adjustment, or mark resolved with notes;
     post-action refresh of the list (the old TODO).
3. A "Run reconciliation now" affordance (per client or all), calling the run action. On-demand runs
   execute the validation inline in the server action (bounded, per-client) or, for all-clients runs,
   enqueue through the edition-appropriate rail (Temporal on EE, pg-boss on CE) — no new EE pg-boss usage.

## Phase 5 — Cleanup

- Delete `server/src/lib/utils/creditReconciliationUtils.ts` (dead legacy).
- Delete or fold `CreditManagement.tsx` and the old `billing-dashboard/` reconciliation components once
  migrated (no orphan copies left).
- Update `docs/billing/credits_and_reconciliation.md` to match reality (terminology, routes, tab).

## Testing summary

- Phase 1 integration tests are the core deliverable (detection + fixes).
- Phase 3 integration tests: identical ledger state from all apply-credit entry points; Add Credit flow
  issues a credit visible on the credits page and in the ledger; detector finds zero discrepancies after
  each path.
- Playwright coverage (per `playwright-testing` skill) for the tab: list renders seeded reports,
  resolve flow closes a report; plus the Add Credit dialog happy path.
- Manual smoke on the dev stack (port 3501): nightly-job-produced report visible in the tab, fix applied,
  balance corrected.

## Out of scope

- Client-portal visibility of reconciliation.
- Changes to credit issuance/application/expiration logic beyond defects Phase 1 uncovers.
- Notifications/alerting on new discrepancies (candidate follow-up).
- Credit draw-down policy controls (per-client/per-contract auto-apply rules, service-type restrictions,
  application priority) — tracked as a 1.5.0 task in the "Alga PSA Releases" project
  ("Credit draw-down policy controls", task 8a4a73dc-5fd6-4b8e-beb7-805bb1601d63).
