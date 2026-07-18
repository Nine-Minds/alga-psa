# Fix quote document template bindings (client/tenant/date placeholders)

**Branch:** `fix/template-issue-quotes`
**Date:** 2026-07-17

## Problem

Quote document templates render fallbacks or blanks for `{{client.name}}`,
`{{client.address}}`, `{{tenant.name}}`, `{{tenant.address}}`,
`{{quote.quoteDate}}`, and `{{quote.validUntil}}` — even in the standard
templates — while the equivalent invoice placeholders interpolate correctly.
A rendered quote shows "Your Company", "Client", and empty Date / Valid Until
values although the underlying data exists.

## Root causes (confirmed in code)

1. **Invoice-only binding aliases applied to quote renders.**
   `packages/billing/src/lib/invoice-template-ast/evaluator.ts` resolves every
   binding path through `resolveInvoiceTemplateBindingAlias`
   (`packages/billing/src/lib/invoice-template-ast/bindingAliases.ts`), which
   rewrites `client.name → customer.name`, `client.address → customer.address`,
   `tenant.name → tenantClient.name`, `tenant.address → tenantClient.address`.
   The invoice and sales-order view models expose `customer` / `tenantClient`,
   but the quote view model (`mapDbQuoteToViewModel` in
   `packages/billing/src/lib/adapters/quoteAdapters.ts`) exposes `client` /
   `tenant` natively. The rewritten paths resolve to `undefined`, so the
   bindings' fallbacks ("Client", "Your Company", "") render instead of data.

2. **Raw `Date` objects defeat the field formatter.**
   `quotes.quote_date` / `valid_until` are `timestamptz` columns; the pg type
   parsers (`packages/db/src/lib/knexfile.ts`) return JS `Date` objects.
   `mapDbQuoteToViewModel` passes them through unconverted (violating the
   declared `ISO8601String | null` type on `QuoteViewModel` in
   `packages/types/src/interfaces/quote.interfaces.ts`), and
   `formatPrimitiveValue` in
   `packages/billing/src/lib/invoice-template-ast/fieldFormatting.ts` returns
   `{ text: null }` for any value that is not string/number/boolean — so date
   fields render blank. The invoice adapter stringifies its dates
   (`formatDateValueToString` in `invoiceAdapters.ts`), which is why invoices
   work.

## Design decisions (approved)

- **Kind-scoped aliases:** `evaluateTemplateAst` takes an optional alias map;
  the default is **no aliasing**. Callers whose view models are
  customer-shaped (invoice, sales-order family) pass the invoice alias map
  explicitly. Quote callers pass nothing.
- **Dates fixed at both layers:** the quote adapter normalizes its date fields
  to ISO strings (matching its type contract and the other adapters), and the
  field formatter additionally learns to format `Date` instances so no future
  adapter can reproduce the silent-blank failure.

## Implementation steps

### 1. Make binding aliasing an explicit evaluator option

`packages/billing/src/lib/invoice-template-ast/bindingAliases.ts`:
- Export the alias map itself (e.g. `INVOICE_TEMPLATE_BINDING_ALIASES:
  Record<string, string>`) alongside the existing
  `resolveInvoiceTemplateBindingAlias` helper (still used by
  `invoice-designer/preview/previewBindings.ts`, which is invoice-only and
  stays as-is).

`packages/billing/src/lib/invoice-template-ast/evaluator.ts`:
- Add an options parameter:
  `evaluateTemplateAst(ast, data, options?: { bindingAliases?: Record<string, string> })`.
- Thread the option down to the three places that currently call
  `resolveInvoiceTemplateBindingAlias` (value binding, collection binding, and
  bare-bindingId resolution in `resolveBindingValue`, plus the bindings loop
  around line 432). With no option supplied, paths resolve verbatim — no
  aliasing.
- Remove the unconditional import/application of the invoice alias resolver.

### 2. Update evaluator call sites

Pass `{ bindingAliases: INVOICE_TEMPLATE_BINDING_ALIASES }`:
- `packages/billing/src/services/pdfGenerationService.ts` — invoice HTML
  (~line 229), invoice PDF (~line 353), sales-order render (~line 460).
- `packages/billing/src/actions/invoiceTemplatePreview.ts` (~line 147).
- `packages/billing/src/actions/invoiceTemplates.ts` (~line 432).
- `packages/billing/src/actions/documentTemplateActions.ts` (~line 198) —
  sales-order-family document previews (verify during implementation that this
  path only serves sales-order/packing-slip/pick-list samples; if it can carry
  quote ASTs, select the map by document kind as in the designer below).

Pass no aliases (quote paths):
- `packages/billing/src/services/pdfGenerationService.ts` — quote preview
  (~line 258) and quote PDF (~line 423).
- `packages/billing/src/actions/quoteTemplatePreview.ts` (~line 119).

Select by document kind:
- `packages/billing/src/components/invoice-designer/transforms/TransformsWorkspace.tsx`
  (~line 420): use the existing `detectDocumentKind` helper
  (`invoice-designer/utils/documentKind.ts`) on the validated AST — `quote` →
  no aliases; `invoice` / `sales-order` → invoice aliases.

### 3. Normalize quote view-model dates

`packages/billing/src/lib/adapters/quoteAdapters.ts`:
- Add a small exported helper (e.g. `toIsoDateString(value: unknown): string | null`):
  `Date` → `toISOString()` (guarding invalid dates), non-empty string →
  trimmed string, anything else → `null`.
- Apply it to `quote_date`, `valid_until`, and `accepted_at` in
  `buildQuoteViewModel`.

### 4. Harden the field formatter against `Date` values

`packages/billing/src/lib/invoice-template-ast/fieldFormatting.ts`:
- In `formatPrimitiveValue`, handle `value instanceof Date` before the
  catch-all: invalid `Date` → `{ text: null }`; valid `Date` → convert to ISO
  string and fall through to the existing string branch (so `format: 'date'`
  produces the locale-formatted date and other formats degrade sensibly).

### 5. Tests

- `packages/billing/src/lib/invoice-template-ast/evaluator.test.ts`:
  - Quote-shaped data (`client` / `tenant` objects) resolves `client.name`,
    `tenant.name`, `tenant.address` **without** aliases (no fallback leak).
  - Invoice-shaped data (`customer` / `tenantClient`) still resolves when the
    invoice alias map is passed.
- New `fieldFormatting.test.ts`: `Date` value with `format: 'date'` renders a
  formatted date; invalid `Date` renders null; existing primitive behavior
  unchanged.
- Quote adapter: unit-test `toIsoDateString` (Date, ISO string, null,
  invalid-date inputs).
- `packages/billing/tests/quote/quoteTemplateAst.test.ts` (or sibling):
  regression test rendering a standard quote template against a hand-built
  `QuoteViewModel` asserting client name, tenant name, quote date, and valid
  until all appear in the evaluated output.

### 6. Manual verification (dev stack on port 3593)

- Open the quote used in the bug report (Q-0003 equivalent) and render the
  standard-template preview/PDF: all six placeholders populate (client
  name/address, tenant name/address, formatted Date and Valid Until).
- Render an invoice preview/PDF: customer and tenant fields unchanged
  (alias regression check).
- Render a sales-order document preview: customer/tenant fields unchanged.

## Out of scope

- Quote **email** templates (`quote-email-templates.ts`) — unaffected, they
  read quote rows directly.
- Renaming the invoice/sales-order view-model shapes (`customer` /
  `tenantClient`) to match the quote shape — larger unification, not needed
  for this fix.
