# Xero Two-Way Sync — Fix Plan

**Date:** 2026-07-13 (repro executed live in the design session; plan finalized 2026-07-14)
**Branch:** `test/xero-two-way-sync`
**Ticket:** alga0002119 — "Xero 2-Way sync investigation" (Augment Technologies / Matt Green)

## Background

Customer report, verbatim: *"How did things go with the Xero 2-way? I've poked the version i can see but not able to get it to pass the Xero 500, not sure if it's actually live yet though."*

The design session **reproduced the journey end-to-end** against a live Xero demo org (Demo Company US) on this worktree's dev stack and catalogued every break. The outbound loop was ultimately driven to **Delivered** — invoices verified inside Xero — but only after clearing six product bugs and several data traps by hand. This plan turns that catalogue into fixes. The customer-facing answer to "is 2-way live?": **outbound invoice export is live (EE); the inbound leg does not exist yet** (Track B scopes it — document only, no inbound code on this branch).

### What the repro proved (all verified live, 2026-07-13/14)

The environment: EE edition, OAuth connect → Demo Company (US) succeeded (tenant-owned credentials via the settings UI), connection `c9c2bbc4-9ad4-43cc-bb9e-0dc14a8233e2`. Batch `70995e4c` (13 lines) reached **Delivered**; invoices INV-001026/23/22/21/19, INV-000951/816/815/814 confirmed in Xero as DRAFT with auto-created contacts and correct totals.

## The Bug Catalogue (fix all of these — Track A)

### Bug 1 — Live Xero mapping UI is dead (tabs render empty, unclickable)
`XeroLiveMappingManager.tsx:34` passes `defaultTabId="Items / Services"` (a display **label**) but the module ids are `xero-live-service-mappings` / `xero-live-tax-code-mappings`. `CustomTabs` (packages/ui/src/components/CustomTabs.tsx:188) always passes its internal value to `Tabs.Root value=…`, so Radix has no matching trigger → no panel renders, silently. Clicking a tab cannot stick because `AccountingMappingManager`'s effect (AccountingMappingManager.tsx:42-47) recomputes the active tab from the URL param — which `updateURL` writes via raw `history.pushState`, invisible to `useSearchParams` — and snaps state back to the bogus id, which CustomTabs' `defaultTab` effect re-forces into Radix.

**Fix:** pass the real module id as `defaultTabId` (or drop the prop); AND fix the manager/CustomTabs feedback loop so a user-selected tab survives (either make the manager fully controlled via CustomTabs' `value` prop with URL sync through the router, or stop reverting state when the URL param is absent). Add a regression test that renders the manager with a stale/unknown `defaultTabId` and asserts the first tab's panel still renders.

### Bug 2 — Live `xero` missing from the export dialog's adapter list
`DEFAULT_ADAPTERS` (packages/billing/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx:79-84) offers quickbooks_csv, xero_csv, quickbooks_online, quickbooks_desktop — no `xero`. A connected Xero tenant cannot create a live export batch from the UI at all (the repro had to invoke the React handler directly).

**Fix:** add `{ id: 'xero', label: 'Xero' }`. Consider gating both OAuth adapters on connection state (only show `xero`/`quickbooks_online` when a connection exists), but do not block on that.

### Bug 3 — AppErrors leak as raw 500s throughout the export flow ("the Xero 500")
Reproduced four distinct raw 500s the customer can hit with ordinary clicks:
- Create with filters matching an existing batch → `AppError: An export batch already exists for this filter selection` → 500.
- Execute a 0-line batch → `AppError: ACCOUNTING_EXPORT_EMPTY_BATCH` → 500.
- Execute a `needs_attention` batch after validation fails → `AppError: … not ready for delivery` → 500.
- (Pre-migration) schema drift surfaced a raw knex `insert into accounting_export_lines … column "document_id" does not exist` SQL error to the browser.

**Fix:** the export server actions (batch create/execute — wherever `AccountingExportInvoiceSelector.createBatchFromFilters` and `AccountingExportService.executeBatch` are invoked from the UI) must catch `AppError` and return a structured `{ success:false, code, message }` the dialog renders as a friendly inline message/toast — matching the pattern `xeroActions.ts` already uses (lines ~77-100). Sweep the remaining Xero surface (routes under `server/src/app/api/integrations/xero/*`, all `xeroActions.ts` exports, adapter-invoking paths incl. `fetchExternalInvoice`/`onTaxDelegationExport` and `XeroClientService.create`'s `XERO_NOT_CONFIGURED`) for the same guarantee: **no raw 500 reachable from any Xero UI action**. Regression tests per entry point with broken preconditions (no creds, dup filters, empty batch, not-ready state).

### Bug 4 — Live-Xero batches can never resolve realm-scoped mappings
`createBatchFromFilters` defaults `targetRealm` **only** for `quickbooks_online` (accountingExportInvoiceSelector.ts:299-304); a `xero` batch gets `target_realm=null`. The resolver (accountingMappingResolver.ts `lookupMapping`) then does `whereNull('external_realm_id')` — but the mapping UI writes `external_realm_id = xeroTenantId` (xeroLiveMappingModules.ts `createMapping`). Empirically confirmed: with 7 correct realm-scoped service mappings present, validation still reported `missing_service_mapping` for every service; nulling the realms made it pass.

**Fix:** default a `xero` batch's `target_realm` to the default connected organisation's `xeroTenantId` (mirror the QBO branch; the connection is available via the stored-connections helper used by `XeroIntegrationSettings`). With a realm set, `lookupMapping`'s `realm OR NULL` branch also keeps any legacy null-realm mappings working. `XeroAdapter.deliver` already passes `connectionId = batch.target_realm ?? null` with a first-connection fallback, so delivery keeps working. Add a test: xero batch + realm-scoped mapping resolves.

### Bug 5 — Timezone bug in the service-period readiness check blocks charges with detail periods forever
`service_period_projection_mismatch` (accountingExportValidation.ts:361): canonical periods come from `invoice_charge_details` timestamptz values (e.g. `2026-05-01T04:00:00Z` — midnight America/New_York) while the export-line snapshot normalizes to UTC date midnight (`2026-05-01T00:00:00Z`). The comparison uses exact ISO strings, so any charge with recurring detail periods fails validation on **every** batch, permanently (reproduced on a fresh batch; introduced with the QBO closed-loop readiness work in `d2baa61e8e`). This affects QBO exports too, not just Xero.

**Fix:** normalize both sides to calendar dates (or a common timezone-stable representation) before comparing, in one shared helper used by both the snapshot writer and the validator. Unit test with a timestamptz fixture at a non-UTC offset.

### Bug 6 — Invoice generation still writes charges with null `net_amount`; one bad charge fails the whole batch
Charges created 2026-06-11 — months after backfill migration `20260416120000_backfill_invoice_charges_net_amount.cjs` — had `net_amount = NULL` (6 of 17 in the test tenant). `XeroAdapter.transform` throws `XERO_CHARGE_MISSING_NET_AMOUNT` (xeroAdapter.ts:333) which fails the **entire batch** at deliver time (status Failed), after validation had passed.

**Fix (two parts):** (a) find the invoice-generation path that writes charges without `net_amount` and set it at write time (the backfill formula is `total_price - COALESCE(tax_amount,0)`); (b) in the adapter/validation, surface missing `net_amount` as a **per-line validation error** during the readiness pass (like `missing_service_mapping`) instead of a whole-batch hard failure at transform time.

### Bug 7 — Remediation UX traps (lower severity, fix what's cheap)
- **Fix-data-then-retry is impossible on the same batch:** lines are creation-time snapshots; after repairing data the projection check (rightly) rejects stale snapshots, but the only recovery is cancel + recreate, which nothing tells the user. Either re-snapshot lines on execute of a `needs_attention` batch, or surface "cancel and recreate this batch" guidance in the error UI.
- **Stale status in the batch list:** after Execute, the table row kept showing `Pending` while the DB said `needs_attention`; the detail dialog also needed manual Refresh. Refetch after execute completes.
- **Stale Notes:** batch `70995e4c` reached Delivered but still displays the old failure note ("…missing net_amount; run the backfill migration"). Clear/replace notes on successful delivery.
- **Draft leakage into filtered exports:** with `statuses=sent,paid`, a `draft` invoice with `tax_source=pending_external` is still selected (deliberate tax-delegation branch, accountingExportInvoiceSelector.ts:148-153). If intended, label these lines in the preview/errors so operators aren't confused about "where did this draft come from".

## Environment / ops findings (not code, but record them)

- The original dev-DB 500 was **migration skew**: code inserting `document_id`/`document_line_id` (renamed 2026-07-10) against a DB 42 migrations behind. The same class of skew in hosted would produce exactly Matt's 500 — worth checking the hosted deploy pipeline orders migrations before code for the July 10 release.
- Dev DB was reconciled during the session (5 inventory migrations ledger-stamped after verifying tables existed; 36 applied). Repro data repairs made to the test tenant: 7 xero service mappings (realms nulled as the Bug 4 workaround — **revert to realm-scoped once Bug 4 is fixed**), smoke-draft `tax_source→internal`, charge `24007c16` assigned a service, 6 `net_amount` backfills.

## Track A execution order

1. Bug 2 (adapter option) + Bug 1 (mapping UI) — restores the customer-visible path.
2. Bug 4 (realm defaulting) — makes UI-created mappings actually work; revert the test tenant's nulled realms to realm-scoped and re-verify.
3. Bug 5 (timezone) + Bug 6 (net_amount) — makes real-world data exportable.
4. Bug 3 (no-raw-500 sweep) — kills the "Xero 500" class entirely.
5. Bug 7 items as cheap wins alongside the above.

Each fix: smallest correct change + regression test (per `docs/reference/testing-standards.md`), then re-run the live loop below.

## Verification (must demonstrate, not just tests)

Re-run the full journey on this stack (EE dev server on 3708; Xero app `33e0fa01-…` creds in `server/.env.local`, redirect URI for 3708 saved; Demo Company (US) connected):
1. Mapping UI: open Settings → Accounting → Xero; both tabs render tables; create a service mapping through the dialog (realm-scoped) — no fiber tricks.
2. Export dialog offers **Xero**; create a batch (sent,paid, 2026 H1) through the UI only.
3. Execute → batch reaches Delivered with per-line statuses; invoices visible in the Xero demo org.
4. Negative paths return friendly errors, zero raw 500s: duplicate-filter create, execute empty batch, execute needs_attention batch, missing mapping, missing creds (temporarily rename tenant secret), missing net_amount (unbackfilled charge fixture).
5. `npm run lint`, typecheck, targeted vitest suites pass.
6. Record durable discoveries: `alga-dev workflow-add-fact --projectId=13587540-298b-4f3a-9740-05afa2608b70 --step='Draft Implementation' --text='<truth>'`.

## Track B — inbound sync plan (document only)

Write `docs/plans/2026-07-14-xero-inbound-sync-plan.md` (draft, not executed) scoping the true two-way leg:
- `supportsChangePolling` + `fetchChanges` on `XeroAdapter` (Xero If-Modified-Since paging over Payments, CreditNotes, Invoices).
- De-QBO the driver: `SYNC_ADAPTER_TYPE` hard-coding in `packages/billing/src/actions/accountingSyncActions.ts:24` and `syncProducers.ts:25`; route through `resolveConnectedAccountingIntegration` (already returns `adapterType:'xero'`); generalize applier metadata (`qbo_payment_kind`, `qbo_txn_date`, paymentApplier's `'quickbooks'` provider default, driftDetector assumptions).
- Trigger: the existing `accountingSyncCycleHandler` job (server/src/lib/jobs/handlers/) vs Xero webhooks; note QBO's cadence choice and match it.
- Out of scope for Track B doc: implementing any of it on this branch.

## Findings writeup (final step)

Draft a ticket reply for Matt answering: (1) the "Xero 500" class — unhandled errors in the export flow (schema-skew + AppError leaks), all being fixed; (2) live status — outbound invoice export is live for Enterprise (demonstrated end-to-end against a Xero demo org), inbound 2-way is scoped and planned. Tone per `alga-tech-doc-writing`.

## Out of scope

- Xero card copy (explicit decision: leave "Sync: 2-way / Delivery: Live").
- Implementing inbound sync (Track B is a document).
- QBO refactors beyond what a Track A fix strictly requires.
- Production log forensics (window expired).
