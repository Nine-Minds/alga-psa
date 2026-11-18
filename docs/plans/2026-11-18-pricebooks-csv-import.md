# Pricebooks: CSV bulk import and versioned catalog prices

**Card:** 7e64b2e8-16bb-4e3f-bb88-715e3159d194
**PSA ticket:** alga-2026-0003337 (North Valley Technology Solutions, Robert Sewter)
**Branch:** `feature/pricebooks-csv-bulk-import-and-price-updates-for` (on `main` at 4159be8, which contains #3778)
**Date:** 2026-11-18
**Status:** agreed (XO decisions 2026-11-18)

The customer wants to upload a CSV of products and services with prices, keep named pricebooks
("2024", "2025"), and mark one as active. Today every catalog price change is made one item at a
time, and a CSV row whose SKU matches an existing product is skipped.

---

## 1. Context and constraints (§0 compliance)

### 1.1 What exists, verified in this checkout

| Area | Where | What it does |
|---|---|---|
| Effective-dated catalog price | `server/migrations/20260912100000_service_prices_effective_dating.cjs` | `service_prices` holds one row per `(tenant, service_id, currency_code, effective_date)`. Existing rows sit at `1970-01-01`. |
| Primary price order | `20261009120000_service_prices_display_order.cjs` | `display_order = 0` is the primary price, which drives `service_catalog.default_rate`. |
| Distribution | `20261112120000_distribute_service_prices.cjs` | `service_prices` is keyed by `(tenant, price_id)` and co-located with `service_catalog`. |
| The single price writer | `packages/billing/src/lib/catalog/serviceCatalogPricing.ts` (`writeServiceCatalogPricing`) | All catalog price writes go through it: the Service form, the rollout dialog, QuickAdd, the services and products REST APIs, and the AMP product applier through `productCatalogCore`. It takes `lockTenantBilling`. It has three modes: `current`, `scheduled` and `scheduledAt`. |
| One-item rollout | `packages/billing/src/actions/servicePriceRolloutActions.ts` | `previewServicePriceChange` sorts every contract line using a service into `willChange` / `custom` / `unreviewed` / `excluded`, using `resolveFixedLineRate`. `applyServicePriceChange` writes through the single writer and is gated on `service:update`. |
| Contract-side policy | `contract_lines.rate_provenance` and `contract_line_service_fixed_config.rate_provenance` (`inherited` / `custom` / `unreviewed`, migrations `20260912110000`, `20260912120000`). `contract_line_unit_pricing_revisions.price_policy` (`catalog` / `override`, `20260922120000`). | An `inherited` line and a `catalog`-policy revision follow the catalog. `custom`, `unreviewed` and `override` do not. |
| Template currency price sets (card 28cb1ead) | `20261012120000_contract_template_currency_and_price_sets.cjs` | `contract_templates.currency_code` plus per-currency `contract_template_price_sets` / `contract_template_prices`. These rates are copied into a contract when it is created from the template. They never follow the catalog later. |
| AMP CSV import (#3778) | `packages/migration-connectors/src/csv/{mapping,engine,values}.ts`, `server/src/app/api/migrations/spreadsheet/route.ts`, `server/src/lib/migrations/{MigrationPlanner,appliers/entityAppliers}.ts` | CSV/XLSX → AMP package → staged records → planner preflight (dry run) → per-entity appliers → identity mappings plus a per-record outcome report. Entities: `products`, `vendor_products`. A product whose SKU matches is mapped and left unchanged (`ProductMigrationApplier`, `SKU_MATCH_WARNING_PREFIX`). Column mapping is inferred from header aliases only, and the user cannot change it. The namespace comes from the file digest, so uploading the same file again resolves to the same identities. Gated on `import_export:manage`. |

### 1.2 Binding constraint: no second rate mechanism

§0 of `docs/plans/2026-09-12-catalog-price-changes-reach-existing-contracts.md` lists the
contract-side rate mechanisms that already exist: pricing schedules, `custom_rate`, unit pricing
revisions and the fixed-config `base_rate`. It also puts the one catalog authority in effective-dated
`service_prices`. Adding another one "would be malpractice". This design therefore adds **no new
table that billing reads a rate from**. A pricebook is a label and a lifecycle on catalog price rows
that already exist. Billing, the resolver, the deferred-revenue report and the simulator keep
reading `service_prices` exactly as they do today.

### 1.3 Defects found in this design's blast radius

These are not optional cleanups. The feature is wrong unless they are fixed.

1. **`current` deletes history.** `writeServiceCatalogPricing` with `current` runs
   `DELETE … WHERE effective_date <= today` and then re-inserts at the epoch
   (`serviceCatalogPricing.ts:251-270`). Once a "2025" pricebook takes effect, any ordinary save in
   the Service Catalog would wipe both the 2024 and the 2025 rows. Versioned pricebooks cannot
   survive that. See §3.3.
2. **The rollout preview hardcodes USD.** `previewServicePriceChange` falls back to the literal
   `'USD'` when no currency is passed and the service has no price row
   (`servicePriceRolloutActions.ts`, the `priceCurrency` expression). It must use the tenant default
   currency (`default_billing_settings.default_currency_code`), the same source the AMP planner uses.
3. **The QBO resolver guesses silently on duplicate names.** `serviceByName` in `qboItemResolver.ts`
   is a `Map` built from every service, so when two services share a name the last one wins. That
   is out of scope here, but it is exactly the behaviour this design forbids, and the shared key
   resolver in §4.3 is built so QBO can adopt it later. A `// LEVERAGE: pattern catalog-item-key`
   marker goes at both sites.

---

## 2. Decision and rationale

### Decision: option (a). A pricebook is a named, dated group of effective-dated `service_prices` rows.

A pricebook (`catalog_price_books`) has a name, **one effective date**, a status and an audit
trail. Its contents are ordinary `service_prices` rows stamped with `price_book_id`. Activating a
pricebook means its rows take effect on its date. "The active pricebook" is the one whose effective
date is the latest that is on or before today. That makes it **derived, not stored**, so there is
exactly one active pricebook by construction.

### Why, in terms of the existing policy

- **Contracts already choose between "follow the catalog" and "keep my price".** Lines that are
  `inherited`, and revisions whose `price_policy` is `catalog`, follow the catalog. `custom`,
  `unreviewed` and `override` do not. Under (a), activating a pricebook *is* a catalog price change,
  so every contract behaves the way its owner already chose, with no new rule to learn.
  `previewServicePriceChange` already shows who follows and who doesn't, so the preview extends it
  instead of inventing a second classification.
- **§0 asks for one catalog authority.** Under (a) there is still one place a catalog rate lives,
  and one resolver step (`catalog`) reads it.
- **History is free.** Effective dating already *is* a versioned price history. "Pricebook 2024" is
  the catalog as it stood from 2024-01-01 until the next pricebook took effect.

### Rejected: option (b), a separate entity that contracts or quotes pin to by id

Pinning a contract to `price_book_id` would be a fifth contract-side rate mechanism. It would sit
next to `custom_rate`, pricing schedules, unit revisions and template price sets, and its meaning
would overlap with `rate_provenance = custom` ("this contract keeps the 2024 prices"). The resolver
would need a new step whose precedence against `pricing_schedule` and `unit_revision` would have to
be invented, and every billing join site from §0.3 of the 2026-09-12 plan would need a pinned-book
branch. The one problem (b) solves, "this client stays on last year's prices", is already solved:
a line marked `custom` at its current rate does not move.

**Revisit (b) only if all of these become true:**
1. Customers need many contracts to follow a *non-current* catalog over time, so that a later
   change to "2024" must reach every contract pinned to 2024, and a `custom` snapshot is not
   enough.
2. Quotes need to be priced from a named non-active pricebook. That would be a read-only
   `asOf`/`price_book_id` argument to the quote price lookup, not a billing pin, and could be added
   under (a) without (b).
3. The four contract-side mechanisms in 2026-09-12 §0 have been merged (follow-up card 2 in that
   plan), so a pin would replace a mechanism instead of adding one.

### How this avoids a third currency mechanism (card 28cb1ead)

Template price sets are a **clone-time snapshot source**: when a contract is created from a
template, the template's rate in the contract currency is copied in, and its provenance is
`custom`. Pricebooks are the **live authority** for `inherited` lines. They stay separate, and this
card adds neither a currency dimension to pricebooks (pricebook rows are already `service_prices`
rows with a `currency_code`) nor a price-set concept to the catalog. The one place they touch:
when a template line has no template price for a currency, the clone already falls back to the
catalog price for that currency, and that price now comes from whichever pricebook is active. No
code change is needed.

---

## 3. Data model and migration sketch

### 3.1 `catalog_price_books`

```
catalog_price_books
  tenant              uuid  not null
  price_book_id       uuid  not null default gen_random_uuid()
  name                text  not null                 -- "2025", "Pax8 Q3 update"
  effective_date      date  not null
  status              text  not null                 -- draft | scheduled | superseded | discarded (see 3.2)
  description         text  null
  source_migration_job_id uuid null                  -- the import job that filled it, if any
  copied_from_price_book_id uuid null                -- set by "make active again" (5.4)
  created_by / updated_by / applied_by uuid null
  created_at / updated_at / applied_at timestamptz
  PRIMARY KEY (tenant, price_book_id)
  UNIQUE (tenant, effective_date) WHERE status IN ('scheduled','superseded')
  UNIQUE (tenant, lower(name)) WHERE status <> 'discarded'
```

- **One applied pricebook per date.** Without this, "the active pricebook" would be ambiguous on a
  date that two pricebooks share.
- Distributed by tenant and co-located with `service_catalog`, following
  `20261112120000_distribute_service_prices.cjs`. Non-transactional, with guards, matching house
  style (`exports.config = { transaction: false }`).
- Register the table in `packages/db/src/lib/tenantTableMetadata.ts`.

### 3.2 Status is stored. "Active" is not.

| status | meaning | rows in `service_prices`? |
|---|---|---|
| `draft` | contents staged, previewable, editable | **no**. Staged records only (§4). Billing cannot see them. |
| `scheduled` | applied. Rows exist at `effective_date`. | yes |
| `superseded` | rows exist but are no longer the latest | yes. Never deleted. |
| `discarded` | draft abandoned, or a scheduled pricebook withdrawn before its date | no (a withdrawal deletes its future rows; see 5.3) |

`active` is computed: the `scheduled`/`superseded` pricebook with the greatest
`effective_date <= today`. Shown as a badge. The status column moves `scheduled` → `superseded` when
a later pricebook takes effect. That is a derived refresh, done lazily on read and never relied on
for correctness. Only the date comparison is authoritative.

### 3.3 `service_prices` additions, and a change to the single writer

```
service_prices
  + price_book_id  uuid null      -- FK (tenant, price_book_id) → catalog_price_books
  + created_by     uuid null      -- who wrote the row; the column is missing today
  index (tenant, price_book_id) WHERE price_book_id IS NOT NULL
```

A NULL `price_book_id` means a one-off price change from the Service Catalog dialog or the APIs,
which is what every existing row is. **Nothing that reads rates changes.**

**Single-writer change** (fixes §1.3 #1). This is a change to how the engine writes, not a new mode
added beside the others:

- `current` stops deleting the current window. For each submitted currency it **upserts the row at
  `today`**: it inserts if absent, and merges the rate if a non-pricebook row already sits at today.
  Earlier rows are kept. If the row at today belongs to a pricebook, the unique key
  `(service, currency, effective_date)` leaves room for only one row. The edit merges into it and
  clears its `price_book_id`, and the audit records the pricebook's original rate (§7). This edge
  only occurs when someone edits an item on the same day its pricebook takes effect.
- A currency **removed** from the current window is the one destructive case. Its rows at or before
  today are deleted, exactly as today, behind the existing confirmation. The Service Catalog shows
  "this removes N historical prices, including pricebook 2024" when it applies.
- A new `appendAt: { effectiveDate, priceBookId, prices }` input replaces `scheduledAt`'s
  insert-or-merge for pricebook writes. It accepts `effectiveDate >= today`. It is **insert-only**:
  a conflicting key with the same rate and the same pricebook is a no-op, and any other conflict is
  an error naming the row. `scheduledAt` becomes `appendAt` with `priceBookId: null` plus a merge
  on its own previous scheduled row, so the rollout dialog keeps its behaviour, and there is one
  path for dated inserts rather than two.
- `default_rate` mirroring is unchanged: it follows the primary row effective today. An `appendAt`
  dated today updates it. A future one does not.

Test T1 (§8) covers the history-keeping change for every existing caller.

### 3.4 What is deliberately not added

- No `price_book_id` on contracts, contract lines, templates or quotes.
- No currency column on the pricebook. A pricebook may contain several currencies because its rows
  carry them.
- No "pricebook lines" table. Draft contents live in the AMP staged-record store that #3778 already
  built (§4), and applied contents are the `service_prices` rows.

---

## 4. Import pipeline

Extend #3778's AMP spreadsheet path. Do not write a second importer.

### 4.1 Shape: split "which item" from "what price"

The pricebook spreadsheet is converted into **two AMP entity streams**, composed rather than
special-cased:

- `products` (existing) and **`services` (new)** AMP entities create items or match existing ones.
  A matched item is still "mapped and left unchanged", so the existing product rule is unchanged
  and no flag is added to it.
- **`catalog_prices` (new)** AMP entity, one per (item, currency):
  `item_package_record_id | item_kind + item_ref | sku | name`, `currency`, `rate_minor`.
  Its applier writes through `writeServiceCatalogPricing({ appendAt })` at the job's pricebook
  date, with `price_book_id` set.

So "a SKU match is skipped" stays true for the *item*, and the *price* is a separate record that is
never skipped. That is exactly the behaviour change the brief asks for, without bending
`ProductMigrationApplier`. When a pricebook import creates a new item, the item's
`price_minor`/`price_currency` are left empty and the price comes from its `catalog_prices` record,
so a new item lands in the pricebook as well.

Spec changes in `packages/migration-spec` (`tables.ts`, `types.ts`, `jsonSchema.ts`, `schema.ts`,
`compatibility.ts`), connector aliases in `migration-connectors/src/csv/mapping.ts`, a
`ServiceMigrationApplier` and a `CatalogPriceMigrationApplier` in `entityAppliers.ts`, and phase
order `products, services → catalog_prices → vendor_products`. AMP export of the new entities stays
out of scope, as it was for products in #3778.

`ServiceMigrationApplier` creates through the same core the services REST API uses: extract
`serviceCatalogCore.ts` next to `productCatalogCore.ts`, so services get one transaction-scoped
create path just as products did in #3778. A new service needs a service type and a billing method.
Both come from job configuration (`configuration.services.serviceTypeId`, `billingMethod`), and the
planner blocks the job when they are missing, following `CONFIG_PRODUCT_SERVICE_TYPE_REQUIRED`.

### 4.2 Pipeline stages

1. **Upload** (`import_export:manage` plus the pricing permission in §7). Same route and same
   limits as today. The request also carries `x-amp-import-profile: price_book` so that one
   spreadsheet fans out to items plus prices, instead of the single `x-amp-entity-type`.
2. **Column mapping.** `inferSpreadsheetMapping` proposes a mapping. **New:** the user confirms or
   corrects it before conversion. The route accepts a confirmed `mapping`, and the inferred one
   becomes the default rather than the only choice. Pricebook columns:

   | canonical | aliases (non-exhaustive) | required |
   |---|---|---|
   | `item_kind` | type, kind, item_type | no. If omitted, a row with a SKU is a product and every other row is resolved by key. |
   | `item_ref` | alga_item_ref, item_ref | no (round-trip key, §4.3) |
   | `sku` | the existing product SKU aliases | no |
   | `name` | the existing product name aliases, service, service_name | yes for rows that create an item |
   | `price` | list_price, price, sell_price, unit_price, rate | yes |
   | `currency` | currency, price_currency | no. Blank means the job currency (below). |
   | `cost`, `cost_currency`, `unit_of_measure`, `description`, `category`, `is_active` | existing | no |

   Several currency columns (for example `Price USD`, `Price CAD`) map to repeated `price` and
   `currency` pairs. Each produces one `catalog_prices` record.
3. **Job currency.** The upload form shows a `CurrencyPicker` that defaults to the tenant's
   `default_billing_settings.default_currency_code`. A blank currency cell means that currency. If
   the tenant has no default currency and the column is absent, the planner blocks the job, reusing
   `CONFIG_TENANT_CURRENCY_MISSING`. A currency that `isSupportedCurrency` rejects blocks that row.
   Nothing is hardcoded.
4. **Stage + preflight** (`MigrationPlanner`, dry run, writes nothing outside staging). Adds
   `checkCatalogPriceConfiguration`, which resolves every row to one of:
   `create` / `update` (new rate differs) / `unchanged` (rate equal to what will be in effect on the
   date) / `unmatched` (no item and no create allowed) / `ambiguous` / `conflict` / `invalid`. Then
   the contract impact preview (§5).
5. **Apply.** The operator names the pricebook (or picks an existing **draft** pricebook) and its
   effective date, then applies. One transaction per item, under `lockTenantBilling` (taken by the
   writer), so that a failing row cannot roll back its neighbours. This matches the AMP applier and
   QBO import behaviour. When every row has been processed, the pricebook moves `draft → scheduled`.
6. **Report.** `MigrationReportService` already writes a per-record outcome report. Add the price
   outcomes (`created`, `updated`, `unchanged`, `blocked:<code>`, with old and new rate and
   currency), downloadable as CSV in the same row order as the upload, with the original row number.
   Duplicate rows (the same item and currency twice in one file) are blocked as
   `CATALOG_PRICE_DUPLICATE_ROW`, both rows listed, and neither is applied.

### 4.3 Stable matching keys, and ambiguity is never guessed

Resolution is a pure function `resolveCatalogItemKey(row, catalogIndex)` in
`packages/billing/src/lib/catalog/catalogItemKey.ts`. It is shared by the planner (bulk SQL
pre-load into an index) and the applier (re-check under lock), so preview and apply cannot
disagree. Precedence:

1. **`item_ref`**: the stable round-trip key. "Download pricebook" (§5.4) exports it. Its value is
   `service_id`, written in a column named *Item ref*. It is never shown in any table in the UI; it
   exists only in the CSV file. An unknown ref is `unmatched`, never a create.
2. **Product SKU**: `normalizeProductSku` and `findProductBySkuCore`, unique by the
   `service_catalog_product_sku_unique` partial index. This is the same rule #3778 uses.
3. **Service key, when there is no SKU**: `(item_kind = 'service', lower(btrim(service_name)))`,
   optionally narrowed by a `service_type` column when the CSV carries one. Services have no unique
   index on SKU or on name, so:
   - exactly one match → matched;
   - **two or more matches → `ambiguous`**: the row is blocked and the preview lists every candidate
     by name, type, billing method and current price, so the operator can tell them apart and fix
     the file with an `item_ref`. No candidate is ever picked.
   - zero matches → `create` when the row has the fields needed to create an item and the job
     allows creation, otherwise `unmatched`.
   - A service row that does have a SKU matches services by SKU first, with the same ambiguity
     rule, because service SKUs are not unique.
4. **Conflict.** When the row carries more than one key and they resolve to different items (an
   `item_ref` pointing at product A while the SKU belongs to product B), the row is blocked as
   `conflict` with both items named.

Inside one file, two rows that would create the same new item (same kind and normalised name or
SKU) are both blocked as duplicates, following the "claimed" logic `qboItemResolver` uses for SKUs.

### 4.4 Idempotency

- **The same file uploaded again** has the same digest, so the same namespace, so the same identity
  mappings. Items already created resolve to their mapping, and their price records find their
  existing rows at `(service, currency, date)` with the same rate and the same pricebook, which is
  an `appendAt` no-op. The report says `unchanged (already applied)`.
- **A different file for the same pricebook date.** Rows not yet applied are inserted. A row that
  conflicts with an existing pricebook row at a *future* date while the pricebook is still
  `scheduled` (its date has not arrived) is an `update` of that pricebook row. The preview shows it,
  and it is allowed because nobody has been billed at that price. On or after the date it is blocked
  as `CATALOG_PRICE_ALREADY_EFFECTIVE`, and the operator must use a new pricebook with a later date.
- **A crash halfway.** Applying again re-runs only the records that have no outcome. This is the
  existing AMP resume behaviour.

---

## 5. Preview UX and pricebook management

All components come from `@alga-psa/ui/components/*`. Money is shown through
`useCurrencyFormat().money(minor)` with the currency taken from the row. Every interactive element
gets a kebab-case `id` per `docs/AI_coding_standards.md`. No raw ids appear in any table.

### 5.1 Where it lives

**Billing settings → Price books** is a new tab in the existing billing settings `CustomTabs`. It
holds a `DataTable` of pricebooks: name, effective date, status `Badge` (`Active` /
`Scheduled` / `Superseded` / `Draft`), number of items, number of currencies, who applied it and
when. Actions: *New price book from CSV*, *Download* (§5.4), *Make active again* (§5.4),
*Withdraw* (scheduled only), *Discard* (draft only).

The import itself reuses the AMP job machinery (staging, preflight, apply, report) behind a
pricebook-specific dialog. The generic Migrations workspace does not show these jobs, so that a
billing user never has to go to the data-migration screen.

### 5.2 Steps in the import dialog (`Dialog id="price-book-import-dialog"`)

1. **Upload**: file input, `CurrencyPicker id="price-book-import-currency"` (tenant default), name
   `Input`, `DatePicker id="price-book-effective-date"` defaulting to the next billing-period
   boundary, the same default the rollout dialog uses.
2. **Map columns.** The four existing CSV import dialogs (`ClientsImportDialog`,
   `ContactsImportDialog`, `TicketImportDialog`, `PhaseTaskImportDialog`) each hand-roll the same
   header-to-field mapping step. The mapping step is extracted once into
   `packages/ui/src/components/SpreadsheetColumnMappingStep.tsx` (a `DataTable` of source header,
   sample values and a `CustomSelect` target) and used here first. The other four are marked
   `// LEVERAGE: pattern spreadsheet-column-mapping` and are not migrated on this card.
3. **Preview.** It writes nothing and says so (the `QboItemImportStep` contract). It contains:
   - summary counts: create / update / unchanged / unmatched / ambiguous / conflict / invalid;
   - a `DataTable id="price-book-preview-grid"` with item, kind, currency, current price,
     new price, change (signed money and %), outcome `Badge`. It can be filtered by outcome, and
     blocked rows show their reason inline (candidate list for `ambiguous`);
   - **Contract impact**, per changed price, computed by the generalised rollout preview (5.3):
     the counts *will change / keep custom price / not yet reviewed / excluded*, each expandable to
     client, contract and line with current → new rate, plus the total monthly revenue change in
     each currency. A line whose unit pricing revision has `price_policy = catalog` counts under
     *will change*. A line with `override` counts under *keep custom price*;
   - `Alert variant="warning"` when any row is blocked: "N rows will not be imported. Fix the file
     and upload it again, or apply the rest."
4. **Apply** (`id="price-book-apply"`). It sits inside the preview panel and shares the preview's
   options, so preview and apply cannot drift apart. *Apply* is disabled while a blocking issue
   exists that applies to the whole job, such as a missing service type for new services. Blocked
   rows do not disable it.
5. **Result**: outcome counts, `Download report` (CSV), and a link to the pricebook.

### 5.3 One preview core for one item or many

Extract the per-line sorting logic out of `previewServicePriceChange` into
`previewCatalogPriceChanges(trx, tenant, changes: {serviceId, currency, newRateCents}[], effectiveDate)`.
It loads each line's resolver inputs **once** for all affected services (`loadFixedLineRateInputs`
with the union of line ids), applies every change to the catalog-price overlay (`withNewPrice`,
generalised to many services), and resolves each line once. `previewServicePriceChange` becomes a
caller with one change. A line that uses three changed services gets one row with the combined
change, not three rows that contradict each other.

The `isPeriodAlreadyInvoiced` exclusion and the inactive-contract and other-currency exclusions
carry over unchanged. A contract that bills in a currency the file does not price lands under
*excluded* with the reason "bills in CAD; this price book has no CAD price for <item>".

### 5.4 Activation, rollback and download

- **Activation is the effective date.** Applying a pricebook dated in the future schedules it. It
  becomes active on that date with no job and no switch, because the resolver reads
  `effective_date <= period.start`. Applying one dated today makes it active immediately.
- **"Make active again" (rolling back to 2024).** This never moves 2024's date or re-points
  anything. It creates a new pricebook, "2024 (re-activated <date>)", with
  `copied_from_price_book_id` set and an effective date the operator picks (today or later). Its
  contents are the 2024 rates as of 2024's date, and it goes through the same preview and apply.
  History stays append-only, and the contract-impact preview shows exactly what the rollback does.
- **Download** exports the catalog *as of the pricebook's date*: every item with its rate in each
  currency, a column marking whether the rate came from this pricebook or was carried forward, and
  *Item ref*. Edited and uploaded again, it is the round-trip path that removes all name ambiguity.

### 5.5 What activation does to contracts that are already running

Exactly what a one-item rollout does today, for many items at once:

- `inherited` lines and `catalog`-policy revisions bill at the new rate from the first service
  period that starts on or after the effective date. A period that has already started keeps its
  rate, because the resolver uses `period.start`.
- `custom`, `unreviewed` and `override` lines do not move. Pricing schedules still take precedence
  over everything.
- A period that has already been invoiced is never re-rated. The preview shows it as excluded.
- Quotes: the quote line picker already reads the price effective today (`quoteItem.ts`). Quotes
  that have been sent keep their stored line prices. No change.
- Line provenance is not reclassified. Pricebooks never turn a `custom` line into an `inherited`
  one, which remains the *Rate review* flow's job (2026-09-12 §1.4). The preview links to it when
  there are unreviewed lines.

---

## 6. Edge cases

| case | behaviour |
|---|---|
| The price in the CSV equals the price in effect on that date | `unchanged`. The row is still written to the pricebook, so the pricebook is complete and can be copied, with zero billing effect. |
| Item exists in only one currency and the CSV adds another | the new `(service, currency)` row goes in at the pricebook date. Contracts in that currency begin following it. The preview shows them. |
| Negative, fractional-minor or non-numeric price | `invalid` (the writer rejects, never rounds, per `minorUnitRateSchema`). The cell is parsed in the currency's exponent, so JPY has 0 decimals, as the #3778 engine already does. |
| A blank price cell | the row is item-only. It creates or matches the item and writes no price record. Vendor cost and other fields follow #3778's rules. |
| The CSV deactivates an item (`is_active = false`) on a matched item | item fields on a matched item are **not** updated (the #3778 rule is kept). Reported as a warning. Item-field updates are out of scope (§10). |
| Product with the same SKU as an existing *service* | the product SKU index is product-only, so it does not match. The row is reported as "creates a new product; a service with this SKU exists", as a warning. |
| Pricebook effective date in the past | refused at the form. `appendAt` requires `>= today`. Back-dating would re-rate periods that may already be billed. |
| Two pricebooks with the same date | refused by `UNIQUE (tenant, effective_date)` and checked in the form first. |
| Withdrawing a scheduled pricebook before its date | deletes its rows (all of them are in the future), moves it to `discarded`, and records the action. Once the date has arrived, withdrawing is refused: use *Make active again* on the previous pricebook. |
| An ordinary Service Catalog edit after a pricebook is active | writes a non-pricebook row at today (3.3). The pricebook view marks the item "changed since this price book". |
| A large file (thousands of rows) | staging and preflight are set-based SQL as in #3778. Apply runs one transaction per item. Preview contract impact is computed once per job, not per row. |
| Bundle line or unit-priced line | goes through `resolveFixedLineRate`, so the preview matches billing (T15 of the 2026-09-12 plan). |
| Hourly and usage services | their catalog read goes through the same effective-dated join (2026-09-12 §0.3), so they follow the pricebook too. Their line-level provenance is the deferred follow-up, so the preview lists them under *will change* only when no line rate is stored. |

---

## 7. RBAC and audit

- **Upload and preview** require `import_export:manage` (the existing AMP gate) **and**
  `billing:read`, because the preview reveals contract rates.
- **Apply** additionally requires `service:update` (the gate `applyServicePriceChange` and
  `updateServicePricing` use, so there is one rule for one write) and `service:create` when the job
  creates items (the gate the QBO item import uses).
- **Withdraw, Make active again, Discard** require `service:update`.
- Each check runs in the server action and again in the applier entry point, because the AMP run is
  asynchronous.
- **Audit:** the pricebook row records who created and applied it and when.
  `service_prices.created_by` and `price_book_id` attribute every row. The AMP job keeps the
  uploaded file digest, the confirmed mapping and the per-row outcome report. When a same-day edit
  detaches a pricebook row (3.3), an `audit_logs` entry is written that names the pricebook, the
  item and the old and new rate.

---

## 8. Testing plan

Suites the repo already uses, and where each new test goes:

- **DB-backed integration (tier1)**: `server/src/test/integration/billing/`. The whole directory
  is in `tier1.manifest.json`. Fixtures: `createTestService`, `createFixedPlanAssignment`,
  `addServiceToFixedPlan`, `materializeRecurringServicePeriods` from `billingTestHelpers.ts`.
  Closest models: `catalogApiScheduledPrices.integration.test.ts`,
  `catalogPriceRateProvenance.integration.test.ts`.
- **AMP pipeline integration**: `server/src/test/integration/ampMigrationPipeline.integration.test.ts`
  (extended by #3778 for products and vendor offers).
- **Infrastructure**: `server/src/test/infrastructure/billing/catalogPricing/`. Any new file must
  also be added to `scripts/lib/infrastructure-selection.mjs` and `server/package.json`, or it runs
  only nightly (the trap documented in 2026-09-12 §4.1).
- **Unit**: `packages/migration-connectors/tests/` (beside `products.test.ts`),
  `packages/migration-sdk/tests/package.test.ts`, `server/src/test/unit/migrations/` (beside
  `productAppliers.test.ts`), and `packages/billing/tests/lib/` for the pure resolvers.

| id | assertion | suite |
|---|---|---|
| T1 | `current` writes keep earlier effective-dated rows. An ordinary save after a pricebook takes effect leaves both pricebooks' rows intact, for every caller of the writer | integration/billing |
| T2 | `appendAt`: insert-only. Same rate and same pricebook is a no-op. A different-rate conflict errors. A past date is refused | integration/billing |
| T3 | CSV with matched product SKU + new price → new `service_prices` row at the pricebook date. The old row is unchanged. The product row is unchanged | ampMigrationPipeline |
| T4 | service matched by name (no SKU) gets a new price. Two services with the same name → `ambiguous`, nothing written, both candidates in the preview | ampMigrationPipeline |
| T5 | conflicting `item_ref` and SKU → `conflict`. Duplicate item and currency rows in one file → both blocked | unit (`catalogItemKey`) + ampMigrationPipeline |
| T6 | new products **and** new services created in the same pass, each with its pricebook price | ampMigrationPipeline |
| T7 | multi-currency: `Price USD` + `Price CAD` columns → two rows. A blank currency cell takes the tenant default (a non-USD default tenant fixture). No default and no column → `CONFIG_TENANT_CURRENCY_MISSING` | ampMigrationPipeline |
| T8 | uploading the same file again → every row reports `unchanged (already applied)`. Zero writes | ampMigrationPipeline |
| T9 | `inherited` line bills the pricebook rate from the first period on or after the date. `custom`, `unreviewed` and `override` lines do not move. `catalog`-policy revision does | integration/billing |
| T10 | a period that has already been invoiced is not re-rated and is listed as excluded in the preview | integration/billing |
| T11 | `previewCatalogPriceChanges` with one change returns exactly what `previewServicePriceChange` returned before the extraction (equivalence). A line using two changed services gets one combined row | integration/billing |
| T12 | the active pricebook is derived: with 2024 and 2025 applied, the active one is 2024 before 2025-01-01 and 2025 after. A same-date second pricebook is rejected | integration/billing |
| T13 | *Make active again* creates a new pricebook with 2024's rates at the chosen date. 2024's rows are untouched. Billing follows | integration/billing |
| T14 | withdrawing a scheduled pricebook removes its future rows. Withdrawing after its date is refused | integration/billing |
| T15 | RBAC: without `service:update` the apply fails. Without `billing:read` the preview fails. Creating items without `service:create` is blocked | integration/billing |
| T16 | the rollout preview with no currency and no price row uses the tenant default currency, not USD (§1.3 #2) | integration/billing |
| T17 | aliases and confirmed-mapping override in the CSV connector. Currency exponent parsing (JPY) | migration-connectors unit |
| T18 | Playwright smoke: upload → map → preview → apply → report download, in Billing settings → Price books | `ee/server/src/__tests__/integration` Playwright, following the playwright-testing skill |

---

## 9. Rollout and feature flag

- PostHog flag **`catalog-price-books`** (pattern from the alga-feature-flags skill, like
  `qbo-item-import`). It gates the Price books tab, the import profile on the spreadsheet route, and
  the new AMP entity types in the spreadsheet allowlist.
- **Not flagged**, because they are fixes that land first and on their own: the history-keeping
  change to the single writer (T1), `appendAt`, and the USD fallback fix (T16). The migrations are
  additive and nullable, so with the flag off nothing that users see changes.
- Order of landing, with the tree green after each step: (1) writer change + `appendAt` +
  migrations; (2) `previewCatalogPriceChanges` extraction with the equivalence test; (3) AMP spec,
  `services` and `catalog_prices` entities, appliers, planner; (4) mapping step component + import
  dialog + Price books tab; (5) download, make-active-again, withdraw.
- Enable for North Valley Technology Solutions first. Write user docs (alga-business-documentation)
  before general availability.

---

## 10. Risks

- **The writer change touches every price save.** Mitigated by T1 across all callers and by
  shipping it unflagged and first, so it is exercised before pricebooks depend on it.
- **Preview cost on large catalogs.** One resolver load for many services could be heavy for
  tenants with many contracts. The preview is computed once per job, set-based, and paged in the
  grid. Measure on a fixture with about 5k lines before general availability.
- **Name matching for services is weak by nature.** Ambiguity is blocked rather than guessed, so
  the risk is friction rather than a wrong price. The round-trip download with *Item ref* is the
  answer to that friction.
- **Operators may expect a pricebook to also set *custom* contract prices.** It will not. The
  preview says so for each line ("keeps custom price"), and the docs must say so.
- **The AMP spec version.** Adding entity types changes the AMP compatibility surface. Bump it in
  `compatibility.ts` the way #3778 did.

## 11. Out of scope

- Pinning a contract or quote to a pricebook (option (b)). See the conditions for revisiting it.
- Updating item fields other than price on matched items (name, description, active flag). #3778
  leaves matched items unchanged, and this card keeps that rule.
- Vendor cost pricebooks. `vendor_products` keeps #3778's upsert behaviour, and a pricebook CSV may
  carry a vendor price list through the existing entity unchanged.
- AMP export of `services` and `catalog_prices`.
- Migrating the four existing import dialogs onto the shared mapping step (markers only).
- Moving QBO item import onto `resolveCatalogItemKey` (marker only).
- Hourly and usage line provenance (follow-up 1 of the 2026-09-12 plan).

## 12. Open questions for the captain

1. **Should a pricebook be able to change contracts marked `custom`?** This design says no: a
   pricebook moves only contracts that follow catalog pricing, the same as a one-item price change
   today. If Rob expects "2025" to reprice *every* client, that is a different feature: a bulk
   *Rate review* reclassification offered alongside the import. Decide whether that belongs on this
   card.
2. **Should matched items' other fields (name, description, active) update from the CSV?** This
   design keeps #3778's rule that a matched item is left unchanged, apart from its price. Rob's
   "bulk importing of new services, products" is covered either way.

---

## 13. XO decisions on the open questions (2026-11-18, conn desk)

1. **A pricebook never changes a contract marked `custom`.** It moves exactly the contracts that
   follow catalog pricing, the same set a one-item price change moves today. Repricing every client
   is a different feature: a bulk *rate review* that reclassifies `custom` → `catalog` per line,
   offered beside the import and never implicit in it. Out of scope for this card; file it separately
   if NVTS asks.
2. **Matched items change only their price.** Name, description and the active flag stay untouched,
   keeping #3778's rule. Creating new items from the CSV covers the "bulk importing of new services
   and products" half of the ask.

Both answers follow the existing policy rather than adding a rule, so the implementation below is
unchanged; §11 and §12 stand as written otherwise.
