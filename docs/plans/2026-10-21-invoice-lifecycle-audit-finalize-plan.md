The design for all three defects is below; I changed no code. Line numbers are at HEAD `5439482d54` and have drifted from the brief's.

### A. Deleting a quote-converted draft returns 500
- **Current:** `hardDeleteInvoice` (`invoiceModification.ts:2908`) calls `deleteInvoiceWithKnex` (`:2518`), which deletes the invoice row at `:2822`. Nothing clears `quotes.converted_invoice_id`. The FK is declared SET NULL (`20260320100000_create_quotes_tables.cjs:53`), but `20260611150000_fix_tenant_nulling_foreign_keys.cjs:15,54` turns it into NO ACTION on Citus, so prod raises the FK error. Plain Postgres keeps SET NULL, which is why local tests pass. Every other invoice FK with the same gap (hour_blocks, project_billing) is already cleared explicitly; quotes is the only one missing.
- **Design:** in the delete transaction, before `:2822`, add `releaseQuoteConversionForDeletedInvoice`. It locks the quote, sets `converted_invoice_id = null`, and moves the quote back to `accepted` only if it was `converted` and has no `converted_contract_id`. It also writes a `converted_invoice_deleted` QuoteActivity. Reconversion already handles a missing invoice (`quoteConversionService.ts:1091`). The REST path gets the same fix because it shares this function. No migration needed.
- **Adjacent risk:** the UI path never passes `requireDraft` (`:2919`), so once this is fixed, deleting INV-000003 would quietly reverse and cascade the client's portal payment. A new `deleteDraftInvoice` action with `requireDraft: true` should back DraftsTab. The billing-cycle callers keep `hardDeleteInvoice`.

### B. No audit trail for finalize, unfinalize or delete
- **Current:** audit calls are commented out at `:1218` and `:1649`, and the import at `:12`. `auditLog` silently skips when the `app.current_tenant` setting is missing, and server actions never set it. REST sets it by hand (`InvoiceService.ts:900`), as does `accountingAudit.ts:49`.
- **Design:** add `writeInvoiceAudit(trx, tenant, op, {userId, invoiceNumber, before, after})` in `packages/db`, modelled on `accountingAudit`. Operations are `invoice_finalized`, `invoice_unfinalized` and `invoice_deleted`, each recording before/after status and `finalized_at`. Each is written inside its own commit's transaction, so a failed audit rolls the change back. REST delete and finalize use it too.
- **History:** add `GET /api/v1/invoices/{id}/history`, reading `audit_logs` the way `submissionHistory.ts` does, and show it in the invoice preview panel. Today the endpoint returns 404 and no invoice reader of `audit_logs` exists.

### C. Finalize reports failure after committing
- **Current:** the commit happens at `:1140`. Prepayment credit (`:1241`), negative-total credit (`:1312`), auto-apply (`:1397`), deposit credits (`:1444`), events and export (`:1540`) all run afterwards, and any throw goes up through `:1071`. Auto-apply calls the `withAuth` action `applyCreditToInvoice`, which needs `credit:update`. A user with only `invoice:update` therefore commits the finalize and then gets an error. DraftsTab then shows the error and skips the reload (`DraftsTab.tsx:253-256`).
- **Design:**
  - Inside the transaction: prepayment and negative-total credit issuance, since that money belongs to the finalize.
  - After the commit, best-effort and retryable: auto-apply, deposit credits, events, export and autopay. Auto-apply uses `applyCreditToInvoiceInternal` as a system policy, not the user's permission, and is safe to run twice. Each step runs in its own try/catch.
  - Return `{success: true, warnings: [{step, message}]}`. DraftsTab always reloads and shows the warnings.
  - REST finalize (`InvoiceService.ts:939`) is currently a separate engine; it should call `finalizeInvoiceWithKnex`.

### Files, in order
`packages/db` audit helper → `invoiceModification.ts` (A, B, C) → `quoteConversionService` / `QuoteActivity` type → `InvoiceService.ts` plus the new history route → `DraftsTab` and `FinalizedTab`.

### Tests to add (Citus-shaped: cr
