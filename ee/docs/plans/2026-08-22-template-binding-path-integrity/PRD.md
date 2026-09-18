# PRD — Template Designer Binding Path Integrity

- Slug: `template-binding-path-integrity`
- Date: `2026-08-22`
- Status: Draft
- Ticket: `alga0002294`
- Related: `alga0002295` (invoice discount — separate effort, may run in parallel)

## Summary

Make the template designer's Fields catalog **derive its options from the per-type
binding catalogs**, so a field the picker offers is always a field the render model
actually has. Today the picker menu and the path-translation table are two
hand-maintained lists that were never checked against the binding catalogs that
define the real render models, and they have drifted: 23 of 28 quote picker fields
and all 10 sales-order-family fields produce bindings that resolve to nothing.

## Problem

Binding a Data Field via the Fields catalog — or inserting a field token into a
Text Block — produces a binding whose path does not exist in the target render
model. The label renders, the value is blank, and Preview reports
`Shape: SUCCESS / Render: SUCCESS` because nothing is malformed: the binding is
well-formed and simply names a field the data does not have.

### Mechanism

1. The picker menu is hand-declared in
   `shared/workflow/expression-authoring/adapters/invoiceContextAdapter.ts`
   (`createQuoteRootSchema`, `createQuoteTotalsSchema`, `createSalesOrderRootSchema`).
   It describes *the menu*, and is not derived from or checked against any model.
2. On export, `normalizeInvoiceBindingPath`
   (`packages/billing/src/components/invoice-designer/ast/workspaceAst.ts:152-206`)
   translates the picked path into a data path via a hand-written alias table. That
   table was written for the invoice model, which genuinely is camelCase
   (`invoiceNumber`). Quote and sales-order models are snake_case (`quote_number`,
   `so_number`).
3. `registerValueBinding` (`workspaceAst.ts:1425`) reuses an existing binding by
   matching on **path**. `quoteNumber` misses `quote_number`, so rather than reusing
   the correct built-in binding sitting right there, it mints a new one pointing at a
   nonexistent path.
4. The evaluator does `getPathValue(data, 'quoteNumber')` → `undefined` → empty string.

### Measured scope

Every picker option, bound and evaluated against each type's real sample model:

| Document type | Picker fields resolving |
|---|---|
| Invoice | 15 / 16 |
| Quote | 5 / 28 |
| Sales Order | 0 / 10 root fields |
| Packing Slip | 0 / 10 root fields |
| Pick List | 0 / 10 root fields |

The five quote fields that work do so **by coincidence** — `status`, `title`,
`subtotal`, `tax`, `version` are spelled identically in both conventions. So are
`client.*` and `contact.*`. That coincidence is why spot checks pass.

`salesOrder.*` has no alias entries at all, so those paths export verbatim.
Packing slip and pick list reuse the sales-order bindings and sample wholesale
(`registry.ts`), inheriting the defect intact.

Also broken for quotes: `tenant.name` / `tenant.address`, which line 200 maps to
`tenantClient.*` — correct for invoices, wrong for `QuoteViewModel`, which exposes
`tenant.{name,address}`.

### Text Block variant has no workaround

`{{quote.quoteNumber}}` exports `{"type":"path","path":"quoteNumber"}` — a raw path
expression that bypasses the binding catalog entirely, so the "use custom path"
workaround cannot rescue it. `{{quote_number}}` is rejected as a token outright:
`isLikelyBindingTokenPath` requires a dot or membership in `SIMPLE_BINDING_ALIASES`,
which is invoice-only. Quote scalar fields in text blocks are currently unfixable
from the UI.

### Not a regression

`a6b481694f` (2026-03-13) added the quote bindings with snake_case paths.
`9277f30bca` (2026-04-01) added the picker schema and the alias table in camelCase,
in one commit, without cross-checking the bindings file from three weeks earlier.
Neither line has been modified since. The two i18n commits touching this file
(`00a43d572b`, `2d67191f45`, 2026-08-13) have all their hunks elsewhere.

## Production state (verified 2026-08-22)

**No template anywhere is currently rendering blank from this bug.**

| | Found |
|---|---|
| Custom quote templates | 16 across 10 tenants |
| Custom invoice templates | 55 across 28 tenants |
| Sales-order / packing-slip / pick-list | 0 — `document_templates` is empty |
| Templates with dangling bindings | 2, both in tenant `30d77d59` |
| Templates actually rendering blank | 0 |

The two affected templates ("NVTS Standard Quote Template" and its Copy) each carry
`value.quoteDate` and `value.validUntil` alongside the correct built-ins. Each
appears exactly twice in the AST — as the catalog key and as its own `id` — so **no
node references them**. Every field node points at the correct built-in id. Someone
hit this bug around 2026-07-13, worked around it, and left the dead bindings behind.

Consequence: **no repair migration is required.** Fix-forward is correct, with an
optional trivial sweep of those two orphaned bindings.

## Goals

- Every option the Fields catalog offers resolves against the document type's render
  model, for all five document types.
- The picker menu is **generated from the binding catalogs**, so menu and data cannot
  drift apart again.
- Text-block field tokens resolve on the same terms as Data Field bindings.
- A guard test binds every picker option for every document type and asserts it
  resolves, so this class of defect fails CI rather than shipping.

## Non-goals

- Exposing a real invoice discount — split to `alga0002295`.
- Any repair migration for saved templates (production data shows none is needed).
- Reworking the designer UI, the inspector, or the preview pipeline beyond what the
  above requires.
- Changing the render models themselves, or the binding catalogs, except to remove
  `invoice.discount`.
- Monitoring, metrics, or feature-flagging this change.

## Users and Primary Flows

**MSP admin building a quote template**: inserts a Data Field, picks
Quote → Quote Number, previews, and sees `QT-2026-0001`. Same for every field the
menu offers, on every document type.

**MSP admin writing a Text Block**: types or inserts `{{quote.quoteNumber}}` and
sees the value render.

## Functional Requirements

- **FR1** — Picker options for each document type are generated from that type's
  binding catalog (`QUOTE_TEMPLATE_VALUE_BINDINGS`, `SALES_ORDER_*`, invoice
  `buildSharedBindings`), not from a hand-declared schema.
- **FR2** — Picking an option produces a binding that reuses the existing built-in
  binding for that path, rather than minting a duplicate.
- **FR3** — `normalizeInvoiceBindingPath` is either deleted or reduced to a
  document-kind-aware shim that emits real render paths; `denormalizeBindingPath`
  inverts it consistently so import → export round-trips stay stable.
- **FR4** — Text-block tokens resolve through the same corrected mapping, and
  `isLikelyBindingTokenPath` recognises tokens for all document types rather than
  the invoice-only alias set.
- **FR5** — `invoice.discount` is removed from `fieldCatalog.ts` and its computed
  entry removed from `previewBindings.ts`.
- **FR6** — Labels and descriptions in the Fields panel stay at least as good as
  today (no regression to raw `humanizeBindingToken` output for fields that
  currently have curated labels).
- **FR7** — A guard test enumerates every picker option for every document type,
  binds it, exports, evaluates against that type's sample model, and asserts a
  resolved value.

## Risks and Migration Notes

- **Round-trip stability is the main risk.** The standard templates round-trip today
  with `pathsChanged=0`. Any change to the alias layer must preserve that for all
  four quote templates, both sales-order templates, packing slip, pick list, and the
  invoice standards. This is already covered by
  `workspaceAst.roundtrip.templates.test.ts` — keep it green.
- **Two orphaned bindings** in tenant `30d77d59` are dead weight. Optional cleanup;
  no user impact either way.
- **Transform pipeline** (`TransformsWorkspace.tsx`) also calls
  `normalizeInvoiceBindingPath` via `transforms.outputBindingId` — must be updated in
  step with FR3.
- **`INVOICE_TEMPLATE_BINDING_ALIASES`** is applied at render time by invoice and
  document-template previews but *not* by `quoteTemplatePreview.ts`. Leave that
  asymmetry alone; it is currently what makes quote `tenant.name` resolve.

## Acceptance Criteria

- For every document type, every option in the Fields catalog binds to a path that
  resolves against that type's sample model. Verified by test, not by inspection.
- `{{quote.quoteNumber}}` in a Text Block renders the quote number.
- All standard templates still round-trip with zero path changes.
- `invoice.discount` no longer appears in the picker, and no longer appears in
  `previewBindings.ts`.
- Adding a binding to a type's catalog surfaces it in the picker with no other edit.

## Open Questions

- Do we clean up the two orphaned bindings in tenant `30d77d59`, or leave them?
- `fulfillment_type` is rendered by the standard packing slip but is absent from the
  sales-order item schema. Add it while we are in there, or track separately?
