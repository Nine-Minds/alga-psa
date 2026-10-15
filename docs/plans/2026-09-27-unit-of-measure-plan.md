# Plan — Unit of measure: coded, defaulted, and snapshotted onto invoice lines

Card: e90fdb73. Base: `main @ 3ce502a5e1`. Author: XO (conn design desk).

## 1. Problem

Creating a product or service forces a required free-text unit of measure with no
default. Nothing computes with the value; it is a display label only. Free text
cannot serve e-invoicing (Peppol / EN 16931), which needs a UN/ECE Recommendation 20
unit code on every invoice line.

Goal: make the unit a structured, coded attribute with sensible defaults, so operators
rarely think about it and every invoice line carries a machine-readable unit.

## 2. Decisions on the open questions

These decisions are binding for Draft Implementation.

- **D1 — Fixed services default to `C62` (one / each).** The unit describes *what is
  billed*, not the cadence; cadence is already `billing_method` + service period.
  Duplicating cadence into the unit is the current redundancy.
- **D2 — Hourly services default to `HUR` (hour).** Usage services have no safe default
  and remain an explicit operator choice (validated), because only the operator knows
  whether the meter is GB, hours, events, etc.
- **D3 — Products default to `C62`.**
- **D4 — The contract-line usage-config unit stays, as a coded override.** Precedence is
  unchanged from today: catalog unit first, config unit as fallback
  (`computeBucketCharges.ts:372-395`, `billingEngine.ts:6502-6671`). We do not change
  precedence in this card; we only code the value and document the precedence. Making it
  a true override is deferred (see §3).
- **D5 — Custom tenant units must map to a Rec 20 code; the default mapping is `C62`.**
  A tenant may add "license", "seat", "device" etc. as labels, but each carries a code.
  Unmapped/ambiguous existing free-text values are preserved as tenant custom units whose
  code defaults to `C62`; no data is lost.
- **D6 — The invoice template gains the *binding*, not a forced column.** Expose
  `unit_code` + `unit_label` to the invoice template AST so a unit column can be added,
  but do not change the shipped default templates in this card.

## 3. Data model

### 3.1 Unit vocabulary (system reference data)

Add a global reference table `units_of_measure`:

- `code` text PK — the UN/ECE Rec 20 code (`C62`, `HUR`, `DAY`, `WEE`, `MON`, `ANN`,
  `E34`, `4L`, `KGM`, `MTR`, …).
- `label_key` text — i18n key for the localized label.
- `kind` text — `time | count | volume | mass | length | other` (for grouping the picker).
- `is_system` bool — system-seeded vs tenant-custom.

Seeded by migration as reference data. Follow `citus-migration-gotchas`: do **not** copy
reference rows per tenant unless the tenancy pattern for reference tables requires it;
prefer a single global table with a Citus distribution that matches existing reference
tables (verify against `service_types` / other seeded catalogs before committing).

Tenant-custom units live in `units_of_measure` with `is_system = false` and a
tenant column, OR (if the existing reference-table pattern forbids tenant rows) in a
small `tenant_units_of_measure` table keyed by `(tenant, code)`. Draft Implementation
must check the current reference-table convention and pick one; do not invent a third
pattern.

### 3.2 Catalog

Add `unit_code text NULL` to `service_catalog` (products and services both live here,
`item_kind` ∈ service|product). Keep `unit_of_measure` (text) as the **display-label
snapshot** for backward compatibility and API compatibility.

### 3.3 Contract-line usage config and siblings

Add `unit_code text NULL` alongside the existing `unit_of_measure` on:

- `contract_line_service_usage_config`
- contract template usage config
- contract line preset services
- quote items (already a snapshot)

Keep the existing label columns. The label is the rendered value; the code is the
machine value.

### 3.4 Invoice charges (the snapshot)

Add to `invoice_charges`:

- `unit_code text NULL`
- `unit_label text NULL`

Populated at generation time from the resolved unit, exactly as quote items already
snapshot it. This is the hook a future Peppol/UBL export consumes. Do not compute the
unit at render time; snapshot it so historical invoices never change when a catalog
value changes.

### 3.5 Migration and backfill

1. Create the vocabulary table and seed system units.
2. Add the code columns (nullable) to the tables above.
3. Backfill: normalize known free-text variants case-insensitively and trimmed — e.g.
   `each/ea/unit/each.` → `C62`; `hour/hrs/hr` → `HUR`; `day/days` → `DAY`;
   `month/mon` → `MON`; `year/annum` → `ANN`; `gb` → `E34`, `tb` → `4L`.
   Normalization runs for every tenant; implemented as a set-based SQL `UPDATE` keyed on
   the lower/trimmed label. Citus-safe (no cross-shard joins); if a distribution key is
   required, include the tenant column.
4. Unknown values: leave `unit_code` null and register the distinct label as a
   tenant-custom unit with code `C62` (D5), so nothing is lost and the picker shows it.
5. Invoice-charge backfill: backfill `unit_code`/`unit_label` from the owning contract
   line's unit where determinable; otherwise leave null (older invoices keep their
   rendered label only). The `down` must not drop columns that a companion migration may
   own — guard the `down` like the companion migration does
   (`20260927120000_contract_recurring_mid_period_adjustments.cjs`), and coordinate
   ownership before merge.

## 4. Resolution layer (one resolver)

Add a single resolver in the billing/catalog layer, e.g.
`shared/billingClients/unitOfMeasure.ts`:

```
resolveUnitOfMeasure({ catalogUnitCode, configUnitCode, fallback }):
  { code, labelKey, label }
```

Precedence per D4: catalog first, config fallback. Default the code to `C62` when
nothing is set. Replace every scattered fallback with this resolver:

- `computeBucketCharges.ts:486` (`config.unit_of_measure || "units"`, else `"hrs"`)
- `invoiceGeneration.ts:593` (`'Each'`)
- `quoteConversionService.ts:800` (`|| 'unit'`)
- `quoteAdapters.ts:100`
- `actions/account.ts:707,732` (`|| 'units'`)
- `RequestAppointmentModal.tsx:494` (`|| 'hour'`)
- EE simulator fallbacks (`"unit"`)
- `getUsageDataMetrics.ts:65` grouping

After this, no `"units" | "hrs" | "unit" | "hour" | "Each" | "kit"` literal fallbacks
remain outside the vocabulary.

## 5. Input and API

- **API:** `unit_of_measure` stays accepted/returned as the label string for
  compatibility; add optional `unit_code`. Server applies the same defaults as the UI
  when neither is supplied (product/service → `C62`; hourly → `HUR`; usage → required).
  Remove the `z.string().min(1)` required gate in `productSchemas.ts:39` and
  `serviceSchemas.ts:29`; validate `unit_code` against the vocabulary when present.
- **UI:** rework `packages/ui/src/components/UnitOfMeasureInput.tsx` to be
  vocabulary-backed (grouped by `kind`, localized labels, "Custom…" registers a tenant
  unit with a code). Use it on **every** surface that edits a unit:
  `QuickAddProduct.tsx` (replace the free-text `Input` at `:928`),
  `QuickAddService.tsx`, `ServiceCatalogManager`, `KitManager`,
  contract-line/usage config (`ContractLines.tsx`,
  `service-config/ServiceConfigurationPanel.tsx`,
  `contract-lines/ServiceUsageConfigForm.tsx`), quotes, and the mobile
  `CreateProductModal.tsx`.
- **MCP/chat/OpenAPI registries** are generated from the API schemas; regenerate after
  the schema change.

## 6. What we deliberately are NOT doing

- Purchase-vs-stock unit conversion (buy box of 10 / sell each). The coded model leaves
  room for a later conversion table without rework; we do not build it.
- Peppol/UBL e-invoice export itself.
- Pushing UoM to QBO/Xero (today QBO treats it as Alga-authoritative; unchanged).
- Usage-record unit validation/conversion (GB↔TB).
- Changing the shipped default invoice templates to show a unit column (binding only).
- Changing the catalog-first/config-fallback precedence in this card.

## 7. Risks

- **Migration breadth.** Many tables gain a code column; ensure each is Citus-safe and
  every `down` guards companion-owned columns.
- **Vocabulary tenancy.** Confirm the reference-table Citus convention before choosing
  between a global `units_of_measure` and a tenant-keyed table.
- **Compatibility.** Public API and extension runtime expose `unit_of_measure` as a
  string; keep it and add the code, then regenerate registries, or consumers break.
- **i18n.** New labels need keys across all locales (incl. `xx`/`yy` pseudo-locales);
  run `validate-translations`.
- **Precedence ambiguity.** Catalog-first is preserved; document it in the Contract
  Services UI so operators understand the usage-config unit is a fallback today.

## 8. Testable acceptance

1. Create a product in the UI without touching the unit → saves with each/`C62`;
   create via API without `unit_of_measure` → same default.
2. Hourly service defaults to hour/`HUR`; fixed service to each/`C62`; usage service
   requires an explicit unit and rejects an empty one.
3. Every unit editor uses the one standard picker; no free-text unit input remains
   (grep-assertable).
4. Migration: known variants normalize to codes; unknown values preserved as tenant
   custom units coded `C62`; migration runs under Citus; `down` guards shared columns.
5. Generated invoice charges carry `unit_code` and `unit_label`; usage bucket
   descriptions use the resolved label (no hard-coded "units"/"hrs").
6. Quotes → contract/invoice conversion carries the coded unit through.
7. Client portal, usage report, simulator, and extension read API show the resolved
   label, and expose the code where the API already returns an object.
8. High-value tests only (80/20): migration normalization, default resolution, invoice
   snapshot, API default. No tests for thin pass-throughs.

## 9. Suggested implementation order

1. Vocabulary table + seed migration.
2. Code columns + normalization/backfill migration (Citus-safe, guarded `down`).
3. Resolver + replace fallbacks; unit tests for resolution/defaults.
4. API schema changes + regenerate registries.
5. `UnitOfMeasureInput` rework + wire all editors; i18n keys.
6. Invoice-charge snapshot columns + generation wiring; template AST binding.
7. Integration/DB tests for snapshot; live smoke for the create-product and
   invoice-line flows.
