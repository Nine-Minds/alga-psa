# Scratchpad — Extension Invoicing (Manual Invoice MVP)

- Plan slug: `extension-invoicing-manual-invoices`
- Created: `2026-01-14`

## What This Is

Rolling notes for implementing an invoicing host API capability for extensions (MVP: create draft manual invoices).

## Starting Context / Relevant Existing Code

- Capability registry: `ee/server/src/lib/extensions/providers.ts`
- Install config + provider grants: `ee/server/src/lib/extensions/installConfig.ts`
- Gateway passes install + providers + user info to Runner:
  - `server/src/app/api/ext/[extensionId]/[[...path]]/route.ts`
- Existing internal host API pattern (scheduler):
  - Server host API: `ee/server/src/lib/extensions/schedulerHostApi.ts`
  - Internal route: `ee/server/src/app/api/internal/ext-scheduler/install/[installId]/route.ts`
  - Runner calls internal route: `ee/runner/src/engine/host_api.rs` (`scheduler_request`)
  - Runner capability constants: `ee/runner/src/providers/mod.rs`
  - WIT: `ee/runner/wit/extension-runner.wit`
  - JS SDK types: `sdk/extension-runtime/src/index.ts`

## Invoice Domain Touchpoints

- Manual invoice API route (user-authenticated):
  - `server/src/app/api/v1/invoices/manual/route.ts`
  - `server/src/lib/api/controllers/ApiInvoiceController.ts` → `invoiceService.generateManualInvoice(...)`
- Core manual invoice creation expects permissions + user attribution:
  - `server/src/lib/api/services/InvoiceService.ts` (`generateManualInvoice` uses `context.userId`)
- Manual invoice schemas (for input shape parity):
  - `server/src/lib/api/schemas/invoiceSchemas.ts` (`manualInvoiceRequestSchema`, `manualInvoiceItemSchema`)

## Open Decisions

- Capability naming: **decided** `cap:invoice.manual.create`
- Authorization model: **decided** capability-only (no user required)
- Output shape: **decided** minimal `{ invoiceId, invoiceNumber, totals }`
- Inputs: **decided** include invoice header fields (`invoiceDate`, `dueDate`, `poNumber`)
- Prepayments: **deferred** (no `isPrepayment` / `expirationDate` in MVP)
- Invoice attribution (MVP): **implemented** using a tenant user id fallback (first `users.user_id` for tenant) to satisfy required `created_by` fields when persisting invoice charges. This is a stopgap until we add a dedicated “extension/system principal” strategy.

## Commands / Runbooks

- Validate plan folder: `python3 scripts/validate_plan.py ee/docs/plans/2026-01-14-extension-invoicing-manual-invoices`

## Implementation Notes

- `server/src/lib/services/invoiceService.ts` now uses `import type { Session } from 'next-auth'` and a dynamic import for `getSession()` so the shared invoice helpers can be imported from non-Next contexts (e.g., EE server tests / host APIs) without pulling in `next-auth` at module load time.
- SDK sample extension: `sdk/samples/component/invoicing-demo/` demonstrates `host.invoicing.createManualInvoice` from an iframe UI.
