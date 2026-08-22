# SCRATCHPAD — Template Binding Path Integrity

## Decisions

- **2026-08-22 — Derive the picker from the binding catalogs** (chosen over patching
  the alias tables). The alias table and the picker schema are two hand-maintained
  lists that already drifted apart; correcting them leaves the same failure mode
  available next time. Generating from the catalogs removes the second source of
  truth. Cost: touches `shared/workflow/expression-authoring`.
- **2026-08-22 — Fix forward, no repair migration.** Production evidence (below)
  shows zero templates currently rendering blank.
- **2026-08-22 — Remove `invoice.discount`; split real discount support to
  `alga0002295`.** The derived value is structurally always zero, not merely
  canvas-only. See below.
- **2026-08-22 — Text-block tokens in scope** (assumed, not explicitly confirmed).
  They share the normalizer being replaced, and unlike Data Fields they have no UI
  workaround at all. Reverse this if the change gets too wide.

## Production findings (2026-08-22)

Read-only queries via `pgvector-coord-1` (see the prod-db-access memory; **the
coordinator ordinal moves — look it up, do not hardcode**).

```
kubectl --context default get pods -n stackgres-pgvector -l role=master --no-headers
kubectl --context default exec -n stackgres-pgvector <coord-pod> -c postgres-util -- \
  psql -U postgres -d server -X -P pager=off -c "SELECT ..."
```

| | Found |
|---|---|
| Custom quote templates | 16 across 10 tenants |
| Custom invoice templates | 55 across 28 tenants |
| Sales-order / packing-slip / pick-list | 0 — `document_templates` empty |
| Templates with dangling bindings | 2, tenant `30d77d59` |
| Templates actually rendering blank | **0** |

The two affected templates are "NVTS Standard Quote Template" (2026-07-13) and its
Copy (2026-08-02). Each carries both the correct and the broken binding:

```
quoteDate        => {"id":"quoteDate",       "path":"quote_date"}   correct, built-in
value.quoteDate  => {"id":"value.quoteDate", "path":"quoteDate"}    broken, picker-minted
```

`value.quoteDate` occurs exactly twice in each AST — as the catalog key and as its
own `id` field — so **nothing references it**. Every field node points at a correct
built-in id (`quoteDate`, `validUntil`, `total`, …). Someone hit the bug, worked
around it, and left the dead binding behind.

Useful query shape for finding dangling bindings:

```sql
WITH b AS (
  SELECT t.tenant, t.template_id, t.name, v.value->>'path' AS path
  FROM quote_document_templates t, jsonb_each(t."templateAst"->'bindings'->'values') v
)
SELECT tenant, name, count(*), string_agg(path, ', ')
FROM b WHERE path IN ('quoteNumber','quoteDate','validUntil', ...)
GROUP BY 1,2;
```

## Why `invoice.discount` is always zero

Discounts are line items (`is_discount` on `invoice_charges`, stored negative) and
the persisted subtotal is already net of them:

```
invoiceGeneration.ts:3232  const subtotal = calculatedSubtotal + discountSubtotalAdjustment  // negative
invoiceGeneration.ts:3245  const totalAmount = finalSubtotal + finalTax
```

So `total === subtotal + tax`, making `previewBindings.ts`'s
`Math.max(0, subtotal + tax - total)` identically `0`. Confirmed on all three
production invoices carrying discount lines: `derived_discount_is_zero=3, nonzero=0`.

The render model also cannot *see* discounts — `mapDbInvoiceToWasmViewModel`
(`invoiceAdapters.ts:344-373`) drops `is_discount`, and `WasmInvoiceLineItem` has no
such field. Exposing a real discount needs a gross-vs-net subtotal decision, which is
why it is `alga0002295` and not this plan.

## Measured picker health (before the fix)

Harness: import a standard template, set `metadata.bindingKey` on a field node,
`exportWorkspaceToTemplateAst`, then `evaluateTemplateAst` against the type's sample.

```
Invoice       15/16   (only invoice.discount blank)
Quote          5/28
Sales Order    0/10   root fields
Packing Slip   0/10   root fields
Pick List      0/10   root fields
```

Quote fields that work do so **by coincidence** (identical in both conventions):
`status`, `title`, `subtotal`, `tax`, `version`, plus `client.*` and `contact.*`.

## Gotchas

- **`registerValueBinding` matches on PATH, not id** (`workspaceAst.ts:1425`). This is
  why a correct built-in binding sitting right there gets ignored and a duplicate
  minted. If the resolved path is right, the reuse works for free.
- **`INVOICE_TEMPLATE_BINDING_ALIASES` is render-time, and asymmetric.** Invoice and
  document-template previews pass it; `quoteTemplatePreview.ts:122` does not. That
  asymmetry is load-bearing — it is why quote `tenant.name` (path `tenant.name`)
  resolves today. Do not "tidy" it.
- **`TransformsWorkspace.tsx:435`** also calls `normalizeInvoiceBindingPath` through
  `transforms.outputBindingId`. Easy to miss.
- **`resolveDesignerDocumentKind`** sniffs the binding catalog first and falls back to
  substring-matching `metadata.templateName`. Changing catalog ids could shift kind
  detection — `T046` guards this.
- **Packing slip / pick list are not separate binding catalogs.** They reuse the
  sales-order catalog and sample via `registry.ts`, so fixing sales order fixes all
  three at once.
- **`fulfillment_type`** is rendered by the standard packing slip table but is absent
  from the sales-order item schema, so it cannot be re-added through the picker.
- The custom-path input commits on `onChange` AND `onBlur`
  (`DesignerSchemaInspector.tsx:289-291`); the `commit` flag only controls
  undo-history batching (`designerStore.ts:1270`). The original report's
  "only commits on Enter" claim did not reproduce.

## History — this shipped broken, it is not a regression

```
a6b481694f  2026-03-13  quote bindings, snake_case paths
9277f30bca  2026-04-01  picker schema + alias table, camelCase (same commit)
```

Neither line modified since. The i18n commits that touch `workspaceAst.ts`
(`00a43d572b`, `2d67191f45`, 2026-08-13) have all their hunks elsewhere. Labels
surviving while values vanish is by design: `react-renderer.tsx:492` resolves label
from the i18n key and value from `evaluation.bindings` independently.

## Links

- Ticket: `alga0002294`
- Split-out discount ticket: `alga0002295`
- Key files:
  - `shared/workflow/expression-authoring/adapters/invoiceContextAdapter.ts`
  - `packages/billing/src/components/invoice-designer/ast/workspaceAst.ts` (152-206, 1425, 1524)
  - `packages/billing/src/components/invoice-designer/fields/fieldCatalog.ts`
  - `packages/billing/src/components/invoice-designer/preview/previewBindings.ts`
  - `packages/billing/src/lib/quote-template-ast/bindings.ts`
  - `packages/billing/src/lib/sales-order-template-ast/bindings.ts`
  - `packages/billing/src/lib/document-templates/registry.ts`

## Commands

```bash
cd packages/billing && npx vitest run tests/quote/
npx vitest run src/components/invoice-designer/ast/workspaceAst.roundtrip.templates.test.ts
```
