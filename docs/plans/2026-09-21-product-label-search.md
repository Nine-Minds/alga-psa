# Implementation Plan — Product "Label" field searchable in catalog pickers

- **Ticket:** alga-2026-0002384 (Ryan Hoffmann, FTS Technology)
- **Card:** Product Label field not searchable in catalog pickers (7aa3de5e-46b5-4850-afc7-168dae06c416)
- **Branch:** feature/product-label-field-not-searchable-in-catalog-pi
- **Author:** robert@nineminds.com — Design Session (conn), 2026-09-21
- **Status:** design only. No implementation, no PR.

---

## 1. Key correction to the brief: there is no `label` column

The card's root-cause note says to "add the label column" to the search predicates.
**There is no `label` column on `service_catalog`.** Verified against every migration
(`server/migrations/202409071803_initial_schema.cjs:409` and
`server/migrations/20260101090000_add_products_fields_to_service_catalog.cjs`) and the
`IService` interface (`server/src/interfaces/billing.interfaces.ts:188-215`).

The product columns that exist are: `sku`, `barcode`, `cost`, `vendor`, `manufacturer`,
`product_category`, plus the license fields.

The field a user **sees and calls "Label"** is the input rendered in the product form at
`packages/billing/src/components/settings/billing/QuickAddProduct.tsx:794-806`:

- input `id="quick-add-product-label"`
- i18n key `quickAddProduct.fields.label.label` → default "Category Label"
  (`server/public/locales/en/msp/billing-settings.json:1023-1024`), placeholder
  "Optional freeform label"
- **it binds to the `product_category` column** (`value={formProduct.product_category}`,
  `onChange … product_category`).

So "make the Label searchable" == **add `sc.product_category` to the catalog search
predicates and surface it in picker rows.** This is the field into which FTS typed
"Grandstream GRP2614". See Open Question 1 for the `manufacturer` overlap.

---

## 2. Confirmed root cause & full search-path inventory

The catalog search only matches `service_name`, `description`, `sku` (and, for the products
REST/scanner paths, `barcode`). `product_category` is never a search predicate anywhere.
**Five** SQL search paths must change; all use the same `whereILike`/`orWhereILike`
case-insensitive substring shape we will preserve.

| # | Path | File:line | Currently matches | Feeds |
|---|------|-----------|-------------------|-------|
| A | `searchServiceCatalogForPicker` | `packages/billing/src/actions/serviceActions.ts:238-242` | service_name, description, sku | **Quote line-item picker**, contract-line picker/wizards (all via `ServiceCatalogPicker`) |
| B | `getServices` | `packages/billing/src/actions/serviceActions.ts:367-371` | service_name, description, sku | Services/Products list filter (`ServiceCatalogManager`/`ProductsManager`); manual invoice line dropdown (`ManualInvoices.tsx`) |
| C | `ServiceCatalogService.list` | `server/src/lib/api/services/ServiceCatalogService.ts:102-109` (+ `searchableFields` `:57`) | service_name, description, sku | REST `/services` search |
| D | `ProductCatalogService.list` | `server/src/lib/api/services/ProductCatalogService.ts:77-88` (+ `searchableFields` `:43`) | service_name, description, sku, barcode | REST `/products` search |
| E | `queryCatalogPickerItems` | `packages/inventory/src/lib/materials.ts:469-475` (SELECT `:484-502`) | service_name, description, sku | **Project & ticket material pickers** (`ProjectMaterialsDrawer`, `TicketMaterialsCard` via each package's `materialCatalogActions`) |

Consumer confirmation for path A (the exact picker Ryan hit):
`QuoteLineItemsEditor.tsx:668` renders `ServiceCatalogPicker`
(`packages/billing/src/components/billing-dashboard/contracts/ServiceCatalogPicker.tsx`),
whose `loadOptions` calls `searchServiceCatalogForPicker`. The same component backs the
contract-line dialog and the contract/template wizard steps.

**Correction vs. an earlier assumption:** the project/ticket **material** pickers do *not*
go through path A. `packages/projects/src/actions/materialCatalogActions.ts:122` and
`packages/tickets/src/actions/materialCatalogActions.ts:85` delegate to
`queryCatalogPickerItems` (path E) in `packages/inventory` — a separate predicate that must
be fixed independently, including adding `product_category` to its SELECT (`:484-502`) so
those pickers can display it.

Sales orders (`server/src/app/msp/inventory/sales-orders/page.tsx`) render a server-listed
table sourced from the list actions above; no independent predicate, so it inherits B/C/D.

**Out-of-scope search-adjacent paths (see §5 / Open Question 4):**
- `server/src/lib/api/services/InventoryService.ts:373-375` — barcode/serial **scanner
  lookup** (prefix `ILIKE`, service_name/sku/barcode). Scanner-oriented, not a text catalog
  search; excluded by default.
- `packages/billing/src/components/billing-dashboard/service-config/ServiceSelectionDialog.tsx:112`
  — client-side filter on `service_name` only (no SQL); excluded by default.
- Global search already indexes `manufacturer`
  (`packages/search/src/indexers/service_catalog.ts`), but not `product_category`.

---

## 3. Changes, in order of work

### Step 1 — Search predicates (the core fix)

Add `.orWhereILike('sc.product_category', <term>)` to each predicate, keeping the exact
casing/substring pattern already used:

1. `packages/billing/src/actions/serviceActions.ts:238-242` (path A) — add after `sc.sku`.
2. `packages/billing/src/actions/serviceActions.ts:367-371` (path B) — add after `sc.sku`.
3. `server/src/lib/api/services/ServiceCatalogService.ts:102-109` (path C) — add after
   `sc.sku`; also add `'product_category'` to `searchableFields` at `:57`.
4. `server/src/lib/api/services/ProductCatalogService.ts:77-88` (path D) — add after the
   `sc.barcode` clause (use the plain `term`, not the GTIN-normalized `barcodeTerm`); also
   add `'product_category'` to `searchableFields` at `:43`.
5. `packages/inventory/src/lib/materials.ts:469-475` (path E) — add after `sc.sku`.

### Step 2 — Return the field to the pickers so it can be displayed

Neither `searchServiceCatalogForPicker` (path A) nor `queryCatalogPickerItems` (path E)
currently selects `product_category`.

1. `packages/billing/src/actions/serviceActions.ts:193-195` — add `'product_category'` to
   the `CatalogPickerItem` `Pick<IService, …>` union.
2. `packages/billing/src/actions/serviceActions.ts:251-262` — add
   `'sc.product_category as product_category'` to the `.select(...)`.
3. `packages/inventory/src/lib/materials.ts:484-502` — add `'sc.product_category'` to the
   SELECT and to the row/item type this helper returns (align with `CatalogPickerItem`).

(Paths B/C/D already select `product_category`:
`serviceActions.ts:419`, `ServiceCatalogService.ts:152`, `ProductCatalogService.ts:127`.)

### Step 3 — Show the Label in picker result rows (secondary text)

Today the option label is built at
`ServiceCatalogPicker.tsx:139-143` as `service_name (sku)` for products.

`AsyncSearchableSelect`'s `SelectOption`
(`packages/ui/src/components/AsyncSearchableSelect.tsx:13-20`) supports only
`value`, `label`, `badge{text,variant}` — **no dedicated secondary/subtitle line.**

Chosen approach (layering-correct, per repo standards — extend the engine to serve the
design rather than cram the design into a label string): add an optional
`secondaryLabel?: string` (or `subtitle?`) to `SelectOption` and render it as muted
secondary text under `label` in `AsyncSearchableSelect`'s option row. Then in
`ServiceCatalogPicker.tsx` populate `secondaryLabel` with `item.product_category` when
present. This is additive and backward-compatible (every existing caller omits it).

Fallback if we decide not to touch the shared component this round: fold it into the label
string (`${service_name} (${sku}) · ${product_category}`). Recorded as the lower-leverage
option; default is the `SelectOption` extension.

`ServiceCatalogPicker` (quote/contract/wizard pickers) needs the display change. The
**material** drawers (`ProjectMaterialsDrawer`, `TicketMaterialsCard`) render their own
`AsyncSearchableSelect` options from `queryCatalogPickerItems`, so once path E returns
`product_category` (Step 2.3), give them the same secondary-text treatment (or, if the
`SelectOption` extension lands, they get it for free wherever their option builder sets it).

### Step 4 — Product form help text + field intent

`QuickAddProduct.tsx:794-806` — add help/description text under the Label field and align
the copy with its real purpose. Target copy (from the card):
"Internal identifier such as manufacturer/model; searchable, never shown to customers."

- Add the string via new i18n keys next to
  `server/public/locales/en/msp/billing-settings.json:1020-1025`
  (e.g. `quickAddProduct.fields.label.help`). Follow `alga-tech-doc-writing` for copy.
- The current display name "Category Label" is misleading given the field's actual use and
  the `product_category` binding; see Open Question 2 before renaming the visible label.

### Step 5 — Tests (see §6).

---

## 4. Internal-only confirmation (requirement #2 — already satisfied, no code needed)

Verified `product_category` is **never** rendered on a customer-facing surface:
`grep -rn product_category` across `server/migrations` (document/quote/invoice template
seeds), `packages/billing/src/services` (incl. `quoteConversionService.ts`),
`packages/billing/src/models/invoice.ts` and `quoteItem.ts`, and `server/src/components`
returns only the schema migration, the search/select/list code, and the form. It is not in
any quote item snapshot, invoice line, document-template binding, or portal view. **Label is
internal-only today and this change keeps it so** — search matches on it but no render path
is added. If a template should optionally show it later, that is a separate card (per brief).

---

## 5. What we are deliberately NOT doing

- **Not** adding a new `label` column or renaming `product_category`. The existing column is
  the field; a rename is a migration + data-migration risk out of scope for this fix.
- **Not** rendering Label on any quote/invoice/portal/document output (stays internal-only).
- **Not** (by default) adding `manufacturer`/`vendor` to search — pending Open Question 1.
- **Not** changing sales-order search separately (it inherits the list actions).
- **Not** reworking picker architecture beyond the minimal `SelectOption` secondary-text
  extension.

---

## 6. Test & verification approach

**Unit — search predicate (primary).** Model on the existing barcode precedent
`server/src/test/unit/api/productCatalogService.barcode.test.ts:192-227`, which asserts the
`searches` array contains the expected column. Add a test asserting a `product_category`
search pushes `{ column: 'sc.product_category', value: '%<term>%' }` and that a row whose
only match is `product_category` is returned. Cover at minimum:
- `ProductCatalogService.list` (path D) — new sibling test file
  `server/src/test/unit/api/productCatalogService.label.test.ts`.
- `searchServiceCatalogForPicker` (path A) — the picker path Ryan hit; add a focused unit
  test using the same `ListQuery` harness pattern (assert predicate includes
  `sc.product_category` and that the returned item carries `product_category`).
- `queryCatalogPickerItems` (path E) — extend the DB-backed test
  `packages/inventory/src/lib/materials.db.test.ts` with a case asserting a label-only match
  returns the row and the row carries `product_category`.

**Component — picker secondary text.** Add/extend a test on `ServiceCatalogPicker` (see
existing `ServiceCatalogPicker`-touching tests under `packages/billing/tests/`) asserting
that when a returned `CatalogPickerItem` has `product_category`, the rendered option shows
that text as secondary/sublabel. If the `SelectOption` extension is taken, also assert
`AsyncSearchableSelect` renders `secondaryLabel`.

**Manual smoke (Smoke Test step).** In the running dev app (port 3634): create/edit a
product with Label "Grandstream GRP2614", open a quote, search "GRP2614" in the line-item
picker → row appears with the Label shown as secondary text; confirm the customer-facing
quote preview does not display it.

**Typecheck/build** the two changed packages (`billing`, `server`) — the `CatalogPickerItem`
type change ripples to consumers and must compile.

---

## 7. Risks

- **Type ripple:** widening `CatalogPickerItem` is additive (optional field) but every
  select feeding it must now include `product_category`; missing it yields `undefined` at
  runtime, not a type error. Mitigated by Step 2 + component test.
- **Shared picker blast radius:** `ServiceCatalogPicker` is reused by contracts + material
  drawers; the `SelectOption` extension must stay backward-compatible (optional field only).
- **i18n coverage:** new help-text key must land in all locale files or fall back to the
  `defaultValue`; follow existing key placement to avoid un-shadowed-locale issues.
- **Naming confusion (product):** "Category Label" bound to `product_category`, alongside a
  separate `manufacturer` field, is genuinely confusing — see Open Questions; the help-text
  edit partially mitigates but does not resolve it.

---

## 8. Open questions (for XO / captain)

1. **Should `manufacturer` (and `vendor`) also be searchable?** Ryan describes Label as
   "manufacturer/model," and there is a dedicated `manufacturer` column that is currently
   also non-searchable. The ticket's literal scope is the "Label" field (`product_category`).
   Recommendation: fix `product_category` now (matches the ticket exactly and where FTS
   actually typed the value); optionally add `manufacturer` in the same PR for parity
   (low-risk, additive) — need a decision.
2. **Rename the visible field label?** The field shows as "Category Label" but is used and
   referred to as "Label" and stores to `product_category`. Renaming to "Label" would match
   the ticket and the new help text, but is user-visible copy churn. Default: keep the name,
   only add help text. Confirm whether a rename is wanted.
3. **Picker display:** confirm the `SelectOption` secondary-text extension is acceptable
   (preferred) vs. folding into the label string (lower-leverage fallback).
4. **Scanner lookup:** should `InventoryService.ts:373-375` (barcode/serial scan lookup)
   also match `product_category`? Default no — it is a prefix scan path, not a text search.
