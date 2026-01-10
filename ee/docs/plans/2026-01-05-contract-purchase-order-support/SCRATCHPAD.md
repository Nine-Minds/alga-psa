# Scratchpad — Contract Purchase Order Support

## Context / Decisions (2026-01-05)

- One PO per invoice (assume single active contract per client).
- Invoice stores PO number as a snapshot at creation time.
- PO number appears in:
  - invoice metadata in-app
  - default invoice PDF header (when present)
  - accounting export/sync reference surfaces (QBO + Xero)
- PO amount (`po_amount`) is advisory “authorized total spend”.
  - Warn, do not block.
  - Consume only for finalized invoices; unconsume when no longer finalized.
- Overages: warn and allow override.
- Batch invoicing: if any invoices in the batch could exceed a PO limit, prompt upfront with allow vs skip; don’t prompt if there’s no possibility of overage.
- Scope includes everything billed on the invoice (contract + non-contract charges); PO context is invoice-level.

## Relevant Code Pointers

- Contract assignment PO fields: `client_contracts.po_required`, `client_contracts.po_number`, `client_contracts.po_amount`
- Billing engine attaches `client_contract_id` to charges: `server/src/lib/billing/billingEngine.ts`
- Invoice generation entry point: `server/src/lib/actions/invoiceGeneration.ts`
- Invoice persistence: `server/src/lib/services/invoiceService.ts`
- Accounting exports:
  - QBO API: `server/src/lib/adapters/accounting/quickBooksOnlineAdapter.ts`
  - QBO CSV: `server/src/lib/adapters/accounting/quickBooksCSVAdapter.ts`
  - Xero API: `server/src/lib/adapters/accounting/xeroAdapter.ts`
  - Xero CSV: `server/src/lib/adapters/accounting/xeroCsvAdapter.ts`

## Known Gaps / Notes

- Current PO-required validation in `generateInvoice` references legacy `client_plan_bundles`; needs alignment to `client_contracts`.
- Invoice table does not currently have an invoice-level PO field; requires migration.
- Xero adapter currently uses `reference` to carry invoice number; we likely need a combined format (invoice + PO) without breaking matching.
- Finalization mapping in UI/actions:
  - `finalizeInvoiceWithKnex` sets `invoices.status = 'sent'` and sets `finalized_at`.
  - `unfinalizeInvoice` clears `finalized_at` and forces `status = 'draft'` when status is not already draft.
  - FinalizedTab treats invoices as “finalized” when `finalized_at` is set OR `status !== 'draft'`.
