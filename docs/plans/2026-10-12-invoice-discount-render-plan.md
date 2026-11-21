# Invoice discount in the render model: implementation plan

**Ticket:** alga0002295 (card 577882b3)
**Branch:** `feature/invoice-discount-in-render-model-gross-vs-net-su`
**Date:** 2026-10-12
**Checked against:** `origin/main` at `d6dc22c273`. Every file:line reference below is from that commit.

---

## 1. Decision: gross vs net

**`invoice.subtotal` keeps its current meaning: net of discounts, before tax.** Two new invoice-level fields hold the pre-discount view:

| View-model field | Picker path | Meaning | Sign |
|---|---|---|---|
| `subtotal` (unchanged) | `invoice.subtotal` | Net subtotal, after discounts, before tax. This is the persisted `invoices.subtotal`. | as today |
| `discountTotal` (new) | `invoice.discountTotal` | Total of all `is_discount` lines, as a positive magnitude. | ≥ 0 when discounts reduce the invoice |
| `grossSubtotal` (new) | `invoice.grossSubtotal` | Subtotal before discounts: `subtotal + discountTotal`. | as `subtotal` |
| `items[].isDiscount` (new) | not in picker (see §4.4) | The line is an `invoice_charges` row with `is_discount = true`. | — |

Both identities hold exactly, because `grossSubtotal` is derived from `subtotal` rather than recomputed from the items:

- `grossSubtotal − discountTotal = subtotal`
- `subtotal + tax = total`

That makes rounding, the `Math.ceil` in `invoiceGeneration.ts:4176`, and the legacy major-unit payloads irrelevant.

### Why net stays

- **Every stored template keeps its numbers.** Custom templates (55+ across 28 tenants, in `invoice_templates."templateAst"`) and the standard templates (in `standard_invoice_templates`) bind by path (`subtotal`, `tax`, `total`). The evaluator reads those paths from the view model directly (`invoice-template-ast/evaluator.ts:82-111`). If `subtotal` were redefined as gross, every discounted invoice would print a subtotal that no longer adds up to its own total, unless each template were migrated as well.
- **Only new fields change anything.** Templates that don't reference `discountTotal` or `grossSubtotal` render byte-identically.
- **It matches what the persisted subtotal already means.** That subtotal is net in all three writers:
  - `invoiceGeneration.ts:4161` (`subtotal = calculatedSubtotal - discountMagnitude`)
  - `updateInvoiceTotalsAndRecordTransaction`, which sums `net_amount` over all charges (`invoiceService.ts:2066-2081`)
  - the manual-invoice path (`invoiceService.ts:1029`)
- **It matches quotes, with a different name for the gross figure.** Quotes already publish a positive `discount_total` (`quoteTotals.ts:16-20`, quote binding `discountTotal` in `quote-template-ast/bindings.ts:16`), so invoice `discountTotal` uses the same sign and binding id. The quote `subtotal` is gross; on invoices that figure is `grossSubtotal`. Because the invoice names say exactly what they mean, `subtotal` doesn't change meaning between document kinds without saying so.

### The intended opt-in layout

`Subtotal before discounts (grossSubtotal) / Discounts (discountTotal, hideWhenZero) / Subtotal (subtotal) / Tax / Total`, or the shorter `grossSubtotal / discountTotal / tax / total`. Both add up.

### What counts as a discount

`discountTotal` covers **every `is_discount = true` row**:

- automatic discounts (`reconcileAutomaticInvoiceDiscounts.ts:239`)
- manual discounts (`invoiceService.ts:1014`)
- **manual credits**, which `invoiceService.ts:890-907` deliberately stores as `is_discount = true`

Negative rows that are not discounts stay inside `grossSubtotal`. These include contract-change adjustments (`reconcileContractChangeAdjustments.ts:441`) and hour-block lines (`hourBlockActions.ts:246`). This follows the persisted flag, which is also what tax and the accounting exports use. The field description says "discounts and credits".

## 2. Current state (verified)

- **The types have no discount fields.** `WasmInvoiceLineItem` (`packages/types/src/lib/invoice-renderer/types.ts:32-59`) has no discount flag, and `WasmInvoiceViewModel` (`:169-233`) has no discount or gross field.
- **The DB read path has the flag but drops it.** `getInvoiceCharges` selects `ic.is_discount` (`packages/billing/src/models/invoice.ts:798`), and `getFullInvoiceById` feeds every persisted render: PDF (`pdfGenerationService.ts:835, 864, 987`), `getInvoiceForRendering` (`invoiceQueries.ts:858-890`) and the client portal (`ClientInvoicePreview.tsx:100`). The mapper then drops the flag (`invoiceAdapters.ts:627-648`).
- **Preview path:** `adaptToWasmViewModel` (`invoiceGeneration.ts:2056-2150`) builds `preview-discount-*` items from `billingResult.discounts` (`:2118-2124`) without a flag. The preview view model never goes through `enrichWithGroupedItems`.
- **Simulator sites (EE):**
  - `ee/server/src/lib/billing/simulator/activityAssumptions.ts:422` replays persisted invoices. Its charge query (`:310` area) does not select `is_discount`.
  - `loadSimulationCalculationInput.ts:1202` builds simulated periods, which have no discount lines.
  - Both call `enrichWithGroupedItems`.
- **`invoiceAdapters.server.ts`** only enriches projects and locations (and excludes discounts from material lines at `:89`). It builds no totals, so it needs no change beyond keeping `isDiscount` intact.
- **Binding catalog:** `buildInvoiceTemplateBindings()` (`invoice-template-ast/standardTemplates.ts:8-71`) is the invoice catalog. The picker is generated from it (`documentBindingCatalog.ts:138-175`). The numeric/currency detection regex `NUMERIC_RENDER_PATH` (`documentBindingCatalog.ts:69`) does not match `discount`.
- **The designer's Discount Row is dead.**
  - `componentSchema.ts:1138-1156` gives it `bindingKey: 'invoice.discount'`.
  - That key is not in the catalog, so `normalizeInvoiceBindingPath` passes it through and the exported path is `invoice.discount`. The `case 'discount': return 'discount'` at `workspaceAst.ts:334-335` only applies when there is no bindingKey.
  - Either way the path doesn't exist on the view model, so real renders show the label with a blank value.
  - The canvas shows `-$50.00` from `DesignCanvas.tsx:577-589` (`case 'discount': return -5000`).
- **Palette rows print raw numbers.** The Subtotal, Tax, Discount and Custom-total rows export as `field` nodes (`workspaceAst.ts:1182-1236`). Their schema defaults set no `format`, and field format defaults to `text` (`fieldFormatting.ts:80-86`). So a palette Subtotal Row probably prints raw minor units in real renders, while the canvas assumes currency (`DesignCanvas.tsx:615`). This is unconfirmed; step 5.1 pins it with a test first.
- **The designer drops `hideWhenZero` on totals rows.** The flag exists in the AST (`packages/types/src/lib/invoice-template-ast.ts:217-229`) and the renderer honours it (`react-renderer.tsx:888-916`), but the designer's totals import (`workspaceAst.ts:2109-2122`) and export (`:1290-1320`) don't carry it.
- **The designer's subtotal description is wrong.** `fieldCatalog.ts:62-79` describes `invoice.subtotal` as "before tax and discounts". The correct wording is after discounts, before tax.
- **Tests that pin today's behaviour:**
  - `documentBindingCatalog.test.ts:84,114-115` asserts that `invoice.discount` is absent.
  - `previewBindings.test.ts:109-124` asserts that there is no derived discount value.
  - `sampleScenarios.ts:285-291, 338-343` contain discount lines with no flag, and their `subtotal` is net.

## 3. Back-compat rules (non-negotiable)

1. **Unreferenced fields change nothing.** No existing standard or custom template may render a different number unless it references `discountTotal`, `grossSubtotal` or `isDiscount`. The fields are additive, `subtotal`, `tax` and `total` are untouched, and no stored AST is migrated.
2. **Legacy Discount Row nodes stay blank.** These are nodes already saved with path `invoice.discount` or `discount`. No binding alias is added, because aliasing would make them show a discount next to a net subtotal. That is exactly the double-count this ticket exists to prevent. Authors opt in by rebinding the node, or by placing a new Discount Row, which binds `invoice.discountTotal`.
3. **Standard templates are not changed in this card.** That means no `standard_invoice_templates` migration. With no conditional construct beyond `hideWhenZero`, a standard template can't show discounts without changing its Subtotal line on discounted invoices; see the open question. Adding the two bindings to `buildInvoiceTemplateBindings()` only adds unreferenced bindings to the code ASTs, which is a no-op at render time.
4. **The derivation is idempotent and safe on old payloads.** If no item carries `isDiscount` (legacy callers or older cached preview payloads), the result is `discountTotal = 0` and `grossSubtotal = subtotal`.
5. **Currency handling is unchanged.** Values are integer minor units, formatted by the existing `format: 'currency'` path, which uses the view model's `currencyCode` (`react-renderer.tsx:237-264, 944-948`; `fieldFormatting.ts:22-27`). No currency is hardcoded.

## 4. Implementation steps

### 4.1 Types: `packages/types/src/lib/invoice-renderer/types.ts`

- On `WasmInvoiceLineItem`, add `isDiscount?: boolean`, documented as "row is an `is_discount` invoice charge (discount or manual credit)".
- On `WasmInvoiceViewModel`, add `discountTotal?: number` and `grossSubtotal?: number`, with doc comments stating the identities in §1. Both are optional on the type, because the simulator and other external constructors build literals. The helper below always sets them on render paths.

### 4.2 One derivation helper: `packages/billing/src/lib/adapters/invoiceAdapters.ts`

- Add an exported pure function `applyInvoiceDiscountSummary(vm)`:
  - `discountTotal = −Σ toFiniteNumber(item.total)` over items with `isDiscount === true`, normalised so that `-0` becomes `0`.
  - `grossSubtotal = vm.subtotal + discountTotal`.
  - It mutates and returns `vm`, in the same style as `enrichWithGroupedItems`.
- Call it at the top of `enrichWithGroupedItems` (`:518`). That one call covers both branches of `mapDbInvoiceToWasmViewModel` and both EE simulator sites.
- In the DB branch item mapping (`:627-648`), add `isDiscount: item.is_discount === true`.
- In the pass-through Wasm branch (`:695-702`), keep `isDiscount` when re-normalising items. The spread already does this; add a test.
- Don't change the recurring/one-time split or the location groups. Discount lines still fall into `onetimeItems` and the unassigned location group, as today. Splitting discounts per group is out of scope.

### 4.3 The other assembly sites

- **`invoiceGeneration.ts` `adaptToWasmViewModel`:** set `isDiscount: true` on the `preview-discount-*` items (`:2120-2123`), then call `applyInvoiceDiscountSummary(previewViewModel)` before returning (`:2150`). `buildPreviewViewModelItem` (`:366`) maps billing charges, which are never discounts, so it needs no flag.
- **`ee/.../simulator/activityAssumptions.ts`:** add `is_discount` to the replay charge select, and pass `isDiscount` into the replay items (`:430-445`). This lets replayed historical invoices show the same discount as their PDF. `loadSimulationCalculationInput.ts` needs no change: it has no discount lines, and the helper runs through `enrichWithGroupedItems`.
- **`invoiceAdapters.server.ts`:** no change. Add an assertion in its existing test that `isDiscount` survives location and project enrichment.

### 4.4 Binding catalog and picker

- **`standardTemplates.ts` `buildInvoiceTemplateBindings()`:** add
  `discountTotal: { id: 'discountTotal', kind: 'value', path: 'discountTotal' }` and
  `grossSubtotal: { id: 'grossSubtotal', kind: 'value', path: 'grossSubtotal' }`.
  The ids match the quote binding id.
- **`documentBindingCatalog.ts`:** extend `NUMERIC_RENDER_PATH` (`:69`) to match `discount`, so `discountTotal` becomes `valueType: 'number'` with the currency default. `grossSubtotal` already matches `subtotal`.
- **`fieldCatalog.ts`:**
  - Correct the `invoice.subtotal` description to "after discounts and credits, before tax".
  - Add curated labels and descriptions for `invoice.discountTotal` ("Discounts": "total of discount and credit lines, shown as a positive amount") and `invoice.grossSubtotal` ("Subtotal before discounts").
  - Follow the file's existing label convention.
- **`isDiscount` stays out of `ITEM_FIELDS.invoice`.** A boolean has no useful display in a table column, and there is no conditional construct to drive with it. It is model data for the derivation and future use.

### 4.5 Designer: Discount Row, totals rows, preview data

- **`componentSchema.ts:1138-1156` (Discount Row):** change the default `bindingKey` to `invoice.discountTotal`, add `format: 'currency'`, and change the label to "Discounts". This is what the item 4.6 test pins.
- **`componentSchema.ts` Subtotal, Tax and Custom-total rows (`:1100-1137`, `:1157-1175`):** add `format: 'currency'` to the defaults, so new palette rows render as money, matching what the canvas already shows. This affects newly placed nodes only; saved ASTs keep their stored format. Gate this on the step 5.1 test confirming the raw-number bug. If the claim turns out false, skip this bullet.
- **`workspaceAst.ts:334-335`:** change the no-bindingKey fallback from `'discount'` to `'discountTotal'`.
- **`workspaceAst.ts` totals import (`:2109-2122`) and export (`:1290-1320`):** carry `hideWhenZero` through, so an opted-in Discounts row with `hideWhenZero` survives a designer save. This also fixes the silent loss of the flag for quote templates.
- **The totals inspector and composite:** expose a `hideWhenZero` toggle per row. Offer "Discounts" (`discountTotal`, `hideWhenZero: true`, i18n `labels.discounts`, which already exists in all 11 locales) and "Subtotal before discounts" (`grossSubtotal`, new i18n key `labels.subtotalBeforeDiscounts`) as addable presets. The default `totals` composite (`componentSchema.ts:972-998`) is unchanged.
- **The new i18n key:** add `labels.subtotalBeforeDiscounts` to `server/public/locales/*/documents.json` (all 11 locale folders, with real translations for de/es/fr/it/nl/pl/pt/sv and pseudo-locales for xx/yy), and to `standardDocumentLabels.ts` (the mirror test is at `standardDocumentLabels.test.ts:10`).
- **`DesignCanvas.tsx:577-589`:** the sample discount fallback becomes `+5000`, matching the positive magnitude. Add a `grossSubtotal` fallback of 125000, so the sample rows add up: 125000 − 5000 = 120000; 120000 + 9600 = 129600. Restrict fallbacks to bindings that resolve in the catalog, so a legacy dead `invoice.discount` node shows empty on the canvas, as it does in real renders.
- **`previewBindings.ts:19-37`:** add `invoice.discountTotal` and `invoice.grossSubtotal` to `flattenInvoiceBindingMap`.
- **`sampleScenarios.ts`:** mark `svc-discount` lines (`:285-291`, `:338-343`) `isDiscount: true`, and run every scenario through `applyInvoiceDiscountSummary`, so sample totals are derived rather than hand-typed. Expected results:
  - `sample-discount-credit`: `discountTotal` 15000, `grossSubtotal` 195000.
  - `sample-mixed-recurring`: `discountTotal` 15000, `grossSubtotal` 595400.

### 4.6 Tests

| Test file | What it covers |
|---|---|
| `invoiceAdapters.test.ts` | The DB branch maps `is_discount` to `isDiscount`. `discountTotal` and `grossSubtotal` follow the identities with mixed discount and credit lines, with no discounts (0 and = subtotal), with legacy major-unit payloads, and with the `subtotal == 0` fallback. The pass-through Wasm branch keeps the flag. `subtotal`, `tax` and `total` are unchanged against the current fixtures. |
| `documentBindingCatalog.test.ts:84,114-115` | Deliberately update: `invoice.discountTotal` and `invoice.grossSubtotal` are present with `valueType: 'number'` and render paths `discountTotal` and `grossSubtotal`. `invoice.discount` stays absent. |
| `previewBindings.test.ts:109-124` | Replace the "no derived discount" test with: `invoice.discountTotal` resolves from sample data. Keep the assertion that `invoice.discount` resolves to nothing. |
| Workspace AST tests (`workspaceAst.*.test.ts`) | A new Discount Row exports a `field` with path `discountTotal` and `format: 'currency'`. A legacy node with `bindingKey: 'invoice.discount'` round-trips unchanged and stays unbound. `hideWhenZero` round-trips on totals rows. |
| Renderer test (next to `react-renderer.print.test.tsx`) | Proves the opt-in layout adds up for a discounted invoice in a non-USD currency (e.g. EUR): `grossSubtotal`, `discountTotal` with `hideWhenZero`, `tax`, `total`. Proves the Discounts row disappears when `discountTotal` is 0. |
| Back-compat test | Evaluate every `STANDARD_INVOICE_TEMPLATE_ASTS` entry plus a representative custom AST against a discounted fixture, with and without the new fields present. The rendered HTML must be identical. |
| `invoiceGeneration` preview unit test | Preview discount items carry `isDiscount`, and the preview view model has `discountTotal` and `grossSubtotal`. |
| `standardTemplateI18n` | Run the test. Regenerate the manifest only if it changes (`UPDATE_STANDARD_TEMPLATE_MANIFEST=1`); the code ASTs gain only unreferenced bindings. |
| Visual goldens (`RUN_VISUAL=1`) | Run them. The fixture has no discount line, so the baselines must not change. |

### 4.7 Order of work

1. §5.1 confirmation test, then types and the helper with its adapter tests.
2. Assembly sites: preview and simulator.
3. Catalog and picker.
4. Designer, preview data and i18n.
5. Back-compat and renderer tests, then typecheck and the billing package test suite.

## 5. Checks before coding

1. Write a focused renderer test: a palette Subtotal Row `field` node with no `format`, bound to `subtotal`. Confirm whether it prints raw minor units. This decides the second bullet of §4.5.
2. Confirm that `ClientInvoicePreview`'s `dbInvoiceData` comes through `getFullInvoiceById`, so that `is_discount` is present. If it doesn't, add `is_discount` to that select.

## 6. Out of scope

- Quote and sales-order discounts.
- Discount calculation and reconciliation. That includes the possible drift between the preview (`billingResult.discounts`) and persistence (`reconcileAutomaticInvoiceAdjustments`).
- Per-group discount splits in the recurring/one-time and by-location aggregates.
- Showing discounts in the Automatic Invoices preview dialog's own totals table (`AutomaticInvoices.tsx:3769`).
- Any change to the standard templates' layout.

## 7. Open question (product)

**Should the standard invoice templates show discounts?** The renderer's only conditional is `hideWhenZero`. If a standard template shows discounts in a way that adds up, its existing "Subtotal" line on discounted invoices must either change to gross or gain a gross line above it, which is a visible change. That would need a `standard_invoice_templates` migration with frozen ASTs (precedent: `20260902090100_add_by_ticket_standard_invoice_template.cjs`).

This plan leaves the standard templates untouched and makes discounts opt-in through the designer. Changing them would be a follow-up, and it would be worth adding a template-level conditional construct first (show a group of rows when `discountTotal ≠ 0`).

**Optional prod audit:** count the custom templates containing a dead `invoice.discount` or `discount` path, to see how many authors placed a Discount Row that has always printed blank:

```sql
SELECT count(*) FROM invoice_templates WHERE "templateAst"::text ~ '"path":\s*"(invoice\.)?discount"';
```

The count doesn't change the decision in §3.2. It sizes any outreach.

## Addendum: reconciliation with main's contract-discount work (alga0002295 deploy-fix)

- **Line-item flag.** `WasmInvoiceLineItem.isDiscount` (and `discountType`, `adjustmentSourceKind`,
  `adjustmentScope`, `adjustmentReason`, `manualLineMetadata`) now come from main (PR #3499,
  `mapDbInvoiceToWasmViewModel` sets `isDiscount: Boolean(item.is_discount)`). This branch no longer declares or maps
  its own; it only adds `discountTotal`, `grossSubtotal` and the shared helper `applyInvoiceDiscountSummary`.
- **Row inclusion: every `isDiscount` row; no `adjustmentSourceKind` filter.** Main writes `is_discount = true` for
  discounts and for manual credits; contract-change true-up/adjustment lines
  (`adjustment_source_kind = 'contract_change'`, `reconcileContractChangeAdjustments.ts`) and computed adjustments
  (`computeDiscountsAndAdjustments.ts`) are `is_discount = false`, so they stay in the net subtotal like any other
  charge and are not counted as discounts. Filtering on kind would risk breaking
  `grossSubtotal - discountTotal === subtotal`; `is_discount` is the single flag every consumer already uses.
  The identity holds by construction since `grossSubtotal = subtotal + discountTotal`.
- **Simulator.** `loadSimulationCalculationInput.ts` marks lines whose canonical charge family is `discount` as
  `isDiscount`, so simulated periods get the same summary through `enrichWithGroupedItems`.
- Main's standard templates define `labels.discounts` but render no discounts row, so they are left unchanged.
