# Vendor Bill Export Alignment — Implementation Plan

**Branch:** `fix/vendor-bill-export-alga0002086`
**Ticket:** alga0002086 — Vendor bill "Export" is offered (and hard-fails) when QuickBooks Online isn't connected for the tenant
**Date:** 2026-07-10
**Status:** Approved design; implementation not started

## Problem

Vendor bill export was built as a one-off manual path that diverges from the
accounting export architecture in three ways:

1. **Manual-only and ungated.** Invoices auto-export on finalize through a
   producer (`enqueueInvoiceAutoExport`) that silently skips when no realm is
   connected, feeding a deduplicated operations queue drained by a scheduled
   sync cycle. Vendor bills instead render a per-row Export button that builds
   a one-bill batch inline with no connection check — clicking it on an
   unconnected tenant throws a raw error. That is the reported bug.
2. **Vendor bills impersonate invoices in the engine.**
   `accounting_export_lines.invoice_id` holds a bill_id, and the line payload
   carries `invoice_number`, `invoice_status: 'vendor_bill'`, and
   `metadata.manual_invoice: true`. The batch row already has `export_type`,
   so the engine is almost document-oriented; the lines table is where the
   fiction lives.
3. **QBO is hardcoded at every layer** even though a five-adapter registry
   exists (QBO, QBO Desktop, QuickBooks CSV, Xero, Xero CSV) and Xero has a
   live OAuth client service. Hardcodes: `vendorBillExportActions.ts`
   (`adapter_type`, mapping `integration_type`), `syncProducers.ts`
   (`SYNC_ADAPTER_TYPE`), `accountingSyncCycleHandler.ts` (`ADAPTER_TYPE` and
   the QBO-credentials cycle guard). No "which accounting integration is
   connected" helper exists anywhere.

## Settled design decisions

| Decision | Choice |
|---|---|
| Scope | Full alignment with the invoice sync pipeline |
| Auto-export trigger | Vendor bill transition `draft → open` |
| Manual UX | Per-row Export button removed; sync state badge + retry on error only; no export affordances at all when no integration is connected |
| Resolver blast radius | New connected-integration resolver used by **both** the invoice and vendor bill producers (and the cycle job handler) |
| Engine schema | Rename `accounting_export_lines.invoice_id → document_id`, `invoice_charge_id → document_line_id`; generalize payload keys |

## Out of scope (tracked elsewhere)

- **alga0002091** — `centsToAmount` divides by 100 regardless of currency,
  corrupting zero-decimal currencies (JPY). Filed 2026-07-10. Do not fix here,
  even though `transformVendorBills` is touched.
- Xero ACCPAY vendor bill support. The capability declaration added in Phase 1
  makes this a clean gap (Xero-connected tenants simply don't get vendor bill
  export) rather than a crash.
- Bulk vendor bill export from the AccountingExportsTab batch screen.

---

## Phase 1 — Connected-integration resolver + adapter capabilities

**New file** `packages/billing/src/services/accountingSync/connectedAccountingIntegration.ts`:

```ts
export interface ConnectedAccountingIntegration {
  adapterType: 'quickbooks_online' | 'xero';
  targetRealm: string;   // QBO realm id, or Xero organisation/tenant id
}
export async function resolveConnectedAccountingIntegration(
  knex: Knex, tenantId: string
): Promise<ConnectedAccountingIntegration | null>
```

- Checks QBO first: reuse `resolveDefaultRealm` (which already validates the
  configured default realm against `getStoredQboCredentialsMap`). Non-null
  realm → `{ adapterType: 'quickbooks_online', targetRealm }`.
- Then Xero: check stored tenant Xero credentials via
  `packages/integrations/src/lib/xero/xeroClientService.ts` (use the stored
  credentials/connection accessor there; follow the same deferred
  `await import('@alga-psa/integrations/...')` pattern `resolveDefaultRealm`
  uses, with the same eslint-disable comment).
- Returns null when nothing is connected. QBO wins if both are connected
  (document this; today's population is QBO-only so behavior is unchanged).

**Adapter capabilities.** In
`packages/types/src/interfaces/accountingExport.interfaces.ts` add
`supportedExportTypes: readonly string[]` to the `AccountingExportAdapter`
interface. Declare on each adapter:

- `quickBooksOnlineAdapter`: `['invoice', 'vendor_bill']`
- `quickBooksDesktopAdapter`, `quickBooksCSVAdapter`, `xeroAdapter`,
  `xeroCsvAdapter`: `['invoice']`

Also export a lightweight `ADAPTER_EXPORT_CAPABILITIES` const map from
`registry.ts` so producers can check capability without instantiating
adapters (adapter `create()` is heavy). A unit test asserts the map agrees
with each adapter instance's declaration.

**Guard in the engine.** `AccountingExportService.executeBatch` throws
`AppError('ACCOUNTING_EXPORT_UNSUPPORTED_TYPE')` when the batch's
`export_type` is not in the adapter's `supportedExportTypes`.

**Replace hardcodes:**

- `syncProducers.ts`: delete `SYNC_ADAPTER_TYPE`; `enqueueInvoiceAutoExport`
  calls the resolver and uses its `adapterType`/`targetRealm` (skips when
  null — same semantics as the current realm check).
- `server/src/lib/jobs/handlers/accountingSyncCycleHandler.ts`: delete
  `ADAPTER_TYPE`; resolve the integration per tenant and run cycles for the
  resolved adapter. The QBO multi-realm loop stays for QBO; Xero resolves to
  a single realm.
- `vendorBillExportActions.ts` mapping-status query: `integration_type` comes
  from the resolved integration instead of the `'quickbooks_online'` literal.

## Phase 2 — Engine honesty migration (document_id rename)

**New migration** `server/migrations/2026MMDDHHMMSS_rename_accounting_export_line_document_columns.cjs`:

- `accounting_export_lines`: rename `invoice_id → document_id`,
  `invoice_charge_id → document_line_id`.
- Inspect `20251026121500_create_accounting_export_tables.cjs` for indexes,
  uniques, or FKs named after the old columns and rename them in the same
  migration. Provide a symmetric `down`.
- RLS policies are tenant-scoped (`20251104120002_update_accounting_export_rls.cjs`)
  and should not reference these columns; verify.

**Code updates (mechanical, scoped to `accounting_export_lines` references
only — do not touch the unrelated `invoice_charges` table usages):**

- `packages/types/src/interfaces/accountingExport.interfaces.ts` —
  `AccountingExportLine.invoice_id → document_id`,
  `invoice_charge_id → document_line_id`.
- `packages/billing/src/repositories/accountingExportRepository.ts`
- `packages/billing/src/services/accountingExportService.ts`
- `packages/billing/src/services/accountingExportInvoiceSelector.ts`
- `packages/billing/src/services/accountingExportValidation.ts`
- All five adapters (`context.lines.map((l) => l.invoice_id)` etc.)
- `packages/billing/src/actions/vendorBillExportActions.ts` status query
  (`line.invoice_id → line.document_id`)
- `packages/billing/src/components/billing-dashboard/accounting/AccountingExportsTab.tsx`
- Tests: `moneyStoryBackend.test.ts` (T017),
  `accountingExportValidation.rules.test.ts`, accounting integration tests
  under `server/src/test/`.

**Payload generalization** (vendor bill lines only): replace
`invoice_number` / `invoice_status: 'vendor_bill'` / `metadata.manual_invoice`
with `document_number` / `document_kind: 'vendor_bill'`. Invoice-line payloads
keep their existing keys — renaming those is invoice-path churn with no
consumer benefit. Update the QBO adapter's vendor-bill payload readers to
match.

## Phase 3 — Vendor bill sync operation, producer, cycle drain

**Operation type.** Add `'export_vendor_bill'` to `SyncOperationType`
(`packages/billing/src/services/accountingSync/accountingSync.types.ts`).
`accounting_sync_operations.operation` is text — verify no CHECK constraint
migration is needed (add one row to the existing constraint if present).

**Producer.** `enqueueVendorBillAutoExport(knex, tenantId, billId)` in
`syncProducers.ts`, mirroring the invoice producer's gates in order:

1. `isEnterpriseEdition()`
2. `autoSyncEnabled`
3. `autoSyncStartDate` cutoff (compare today, same as invoices — the
   transition happens "now")
4. `resolveConnectedAccountingIntegration` non-null
5. `ADAPTER_EXPORT_CAPABILITIES[adapterType]` includes `'vendor_bill'`

Then `SyncOperationsRepository.enqueue` with `operation:
'export_vendor_bill'`, `algaEntityType: 'vendor_bill'`, `algaEntityId:
billId`. Deliberately **not** gated on `defaultExpenseAccountRef`: a missing
expense account must surface as a failed operation with an actionable
message, not a silent skip. Fire-and-forget with catch-and-log, like the
invoice producer. Export it from `packages/billing/src/runtime.ts` (the
runtime-safe, no-auth-wrapper surface).

**Hook point.** `packages/inventory/src/actions/vendorBillActions.ts`
`setVendorBillStatus`: after the transaction commits and the new status is
`'open'`, fire the producer via deferred import:

```ts
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- inventory→billing runtime, deferred to avoid a static cross-feature edge
const { enqueueVendorBillAutoExport } = await import('@alga-psa/billing/runtime');
void enqueueVendorBillAutoExport(db, tenant, billId);
```

(`inventory` is not in the lint rule's vertical set, but keep the comment for
the convention; this mirrors `resolveDefaultRealm`'s deferred import of
integrations.) Bills are always created as `'draft'`
(`createVendorBill` hardcodes it), so the status transition is the single
hook point.

**Cycle drain.** New `drainExportVendorBillOps(deps)` in
`accountingSyncCycleService.ts`, called from `runAccountingSyncCycle`
alongside the invoice drains, only when the cycle's adapter supports
`vendor_bill`:

1. `ops.listPending(..., { operation: 'export_vendor_bill', targetRealm })`.
2. For bills already mapped in `tenant_external_entity_mappings`
   (`alga_entity_type: 'vendor_bill'`), mark the op done (idempotency, same
   check `exportVendorBillToAccounting` does today).
3. Build one scheduled batch for the remaining bills: `createBatch({
   adapter_type, export_type: 'vendor_bill', origin: 'scheduled', ... })` +
   `appendLines` with one line per bill (`document_id: bill_id`,
   `amount_cents` from `vendor_bills.total_amount`, generalized payload).
   The invoice path's `AccountingExportInvoiceSelector` is invoice-specific;
   vendor bill lines are built directly, as the manual action does today.
4. `executeBatch`, then mark ops done/failed. Failure handling mirrors
   `drainExportInvoiceOps`: cancel a blocking scheduled batch, file an
   `accounting_sync_export_error` exception with `entityType: 'vendor_bill'`
   on validation failures or attempt exhaustion. The
   `QBO_VENDOR_BILL_EXPENSE_ACCOUNT_REQUIRED` error lands here as the failed
   op's message — that is the actionable "set a default expense account"
   surface.

## Phase 4 — UI: state, not action

**Status derivation.** Extend `getVendorBillExportStatusesForTenant`
(`vendorBillExportActions.ts`) to consider, in priority order:

1. Delivered export line / batch, or external entity mapping → `exported`
2. Pending or in-progress `export_vendor_bill` op, or a pending/validating
   batch line → `pending`
3. Most recent failed op or failed line/batch → `error` with the op's failure
   message
4. Otherwise → `not_exported`

**Actions.** Replace `exportVendorBillToAccounting`'s inline-batch body with
enqueue semantics: idempotency check (already exported → return status), then
`enqueueVendorBillAutoExport`-equivalent enqueue **without** the
`autoSyncEnabled` gate (an explicit retry is a user decision), return the
`pending` status. Rename the exported action to `retryVendorBillExport` and
update the ghost-usage prop injection in
`server/src/app/msp/inventory/vendor-bills/page.tsx`.

**New context action** `getVendorBillExportContext()` (billing, `billing:read`):
returns `{ integration: { adapterType, label } | null, vendorBillsSupported:
boolean }` from the resolver + capability map. The page injects it alongside
the other actions.

**`VendorBillsManager.tsx`:**

- When `integration` is null or `vendorBillsSupported` is false: render no
  export badges, no export actions — the screen is plain local AP. This makes
  the 0002086 failure path unreachable.
- Otherwise: keep the existing badge map (`not_exported | pending | exported |
  error`); drop the per-row Export button; the `error` badge gets a retry
  action calling `retryVendorBillExport`, reusing the existing toast plumbing
  in `doExport`.
- i18n: add/adjust keys in all locale files (`vendorBills.export.retry`,
  remove the button label if now unused). Follow the recent inventory locale
  sync convention (see commits `464a2156fb`, `af25536ef6`).

## Phase 5 — Tests

- **Resolver:** QBO connected / Xero connected / both (QBO wins) / none.
  Extend `accountingSyncSettings.test.ts` patterns.
- **Capabilities:** const map agrees with adapter declarations;
  `executeBatch` rejects unsupported export types.
- **Producer:** `syncProducers.test.ts` — vendor bill gates (edition,
  autoSync, cutoff, no connection, adapter without vendor_bill capability,
  happy path enqueues deduplicated op).
- **Cycle drain:** `accountingSyncCycleService.test.ts` — drains
  `export_vendor_bill` ops into a scheduled vendor-bill batch; already-mapped
  bills marked done without a batch; failed batch files a `vendor_bill`
  exception and marks ops failed; adapter without capability drains nothing.
- **Status derivation:** pending op → `pending`; failed op message surfaces in
  `error`; mapping fallback unchanged.
- **Rename:** T017 (`moneyStoryBackend.test.ts`) updated and green; full
  billing + accounting suites green (`npx vitest run` in `packages/billing`,
  plus `server/src/test/{unit,integration}/accounting`).
- **Invoice path regression:** invoice auto-export tests still green with the
  resolver in place (QBO-only tenant behaves identically).

## Verification on the dev stack (localhost:3019)

Seeded on 2026-07-10 in the `Oz` tenant (`dd8cb218-…`): bills `TEST-USD-001`
and `TEST-JPY-002` (both `open`, one line each) and
`tenant_settings.settings.accountingSync` populated with a fake realm
`9341454816226327` and expense account ref. Real QBO delivery will fail at
credentials — that's fine; verify up to batch creation and failed-op
surfacing.

1. **Unconnected state (the 0002086 fix):** null out
   `tenant_settings.settings` and confirm the vendor bills screen shows no
   export badges/actions and nothing hard-fails.
2. **Connected state:** restore settings; transition a draft bill to open;
   confirm an `export_vendor_bill` op appears in `accounting_sync_operations`;
   run the cycle (or trigger the job) and confirm a scheduled `vendor_bill`
   batch is created and the badge reflects the op/batch state.
3. **Actionable failure:** clear `defaultExpenseAccountRef`, retry, confirm
   the error badge carries the expense-account message.

## Risks

- The rename touches the mature invoice export path. Mitigation: it is a
  pure rename with symmetric down-migration, and both test suites cover the
  invoice path end to end.
- Resolver behavior must be bit-identical to `resolveDefaultRealm` for
  QBO-only tenants (the entire current population). The invoice producer
  keeps its skip-on-null semantics.
- `accounting_sync_operations` may carry a CHECK constraint on `operation`;
  confirmed during Phase 3 and migrated if present.
