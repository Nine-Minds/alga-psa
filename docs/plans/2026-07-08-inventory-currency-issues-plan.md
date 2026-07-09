# Inventory Currency Issues — Implementation Plan

**Branch:** `fix/inventory-currency-issues`
**Date:** 2026-07-08
**Scope:** Full sweep of the inventory-module currency audit (79 findings / 21 files).

---

## 1. Problem

The inventory module re-invents currency handling instead of using the shared
utilities the codebase already provides. The audit found **79 issues across 21
files** (28 high, 34 medium, 17 low). The symptoms cluster into three product
surfaces plus two genuine data bugs:

- **Entry screens** use raw `<input type="number" step="0.01">` for money and
  either a free-typed currency text field (`VendorPriceList`) or a local 4-item
  currency list (`PurchaseOrdersManager`) instead of the shared picker.
- **Displays** hardcode `$`, re-implement `Intl.NumberFormat`, and use ~11 local
  `money()` / `dollars()` / `fmtCents()` one-liners that all bake in
  `/100 + toFixed(2)`.
- **Defaults** hardcode `'USD'` in ~30 write paths, mislabeling every non-USD
  tenant, and several report/query payloads drop `currency_code` entirely so
  the UI has nothing correct to format with.

Two of these are real bugs, not cosmetics:

1. **Non-2-decimal corruption on write.** Money is stored as `bigInteger` **minor
   units** (cents) everywhere, but writes use `Math.round(x * 100)` and displays
   use `/100`, hardcoding a 2-decimal exponent. A JPY (exponent 0) or BHD
   (exponent 3) amount is persisted at the wrong magnitude.
2. **Hardcoded `'USD'` write-defaults** land on persisted rows and report
   payloads, not just function parameters.

### Root cause — two missing layers

The same private one-liner appears ~11 times because nothing binds the shared
core formatters to *(a record's `currency_code`, the current user's locale)*.
And the tenant-default-currency lookup exists only as a **private local helper**
in billing (`getTenantDefaultCurrency` in
`packages/billing/src/actions/profitabilityReportActions.ts:305`), so inventory
would be re-inventing a third copy. Both are classic missing-layer signals.

---

## 2. What already exists (reuse, do not re-create)

- **Core primitives** — `packages/core/src/lib/formatters.ts`:
  `formatCurrencyFromMinorUnits(minorUnits, locale, currency)`,
  `formatCurrency`, `currencyFractionDigits(currency, locale)`,
  `toMinorUnits(value, locale, currency)`. These derive the exponent from
  `Intl.NumberFormat`, so they are correct for JPY/BHD. Exported from
  `@alga-psa/core`. `SalesOrdersManager.tsx:25` already imports them.
- **Shared currency list** — `packages/core/src/constants/currency.ts`:
  `CURRENCY_OPTIONS`, `getCurrencySymbol(code)`.
- **Locale-aware money input** — `packages/ui/src/components/CurrencyInput.tsx`
  (reads locale from `useOptionalI18n()`).
- **Locale source** — `useOptionalI18n()` (`packages/ui/src/lib/i18n/client.tsx:278`),
  fallback `LOCALE_CONFIG.defaultLocale`.
- **Tenant default currency** — `default_billing_settings.default_currency_code`
  (the column billing already reads).
- **A dashboard-local `useCurrencyFormat` + `CurrencyFormatProvider`** already
  exists in `packages/inventory/src/components/dashboard/shared.tsx:40-81` (from
  PR #2883). It is the right *shape* (context-seeded currency+locale, call sites
  pass only `cents`) but re-implements `Intl.NumberFormat` and hardcodes `/100`.
  This plan **promotes and rebases it**, it does not start from scratch.

---

## 3. Design decisions (settled)

- **Two general shared layers, inventory-only adoption this branch.** Billing is
  left untouched except a `// LEVERAGE: friction` marker on its private resolver.
- **Storage convention is minor-units (cents).** Display takes minor units;
  writes convert major→minor via `toMinorUnits`. **Forward-correctness only — no
  backfill migration** (these tables are weeks old; assume no non-USD data).
- **No FX.** There is no general "convert amount X→Y" service. We do not convert,
  sum across, or group mixed currencies.
- **Mixing is prevented, not summed.** It is only structurally possible at two
  sites (see §5). Elsewhere currency is header-level and lines inherit it.
- **Cross-*document* rollups** (dashboard tiles, PO `openTotal`) format in the
  tenant default currency and make no cross-currency claim.

---

## 4. Layer 1 — `useCurrencyFormat` (display), promoted to `packages/ui`

**Goal:** one hook every inventory display site calls; deletes all ~11 local
money helpers and every `/100 + toFixed(2)`.

**Create** `packages/ui/src/lib/currency/useCurrencyFormat.tsx` (client module):

- `CurrencyFormatProvider({ currencyCode, locale?, children })` — context that
  seeds the document/page currency. `locale` defaults to `useOptionalI18n()`.
- `useCurrencyFormat()` returns:
  - `money(minorUnits: number, currencyOverride?: string): string` — wraps
    `formatCurrencyFromMinorUnits(minorUnits, locale, currencyOverride ?? contextCurrency)`.
    The **`currencyOverride`** argument is what makes list screens correct, where
    each row carries its own `currency_code` (PO list, vendor bills list).
  - `moneySigned(minorUnits, currencyOverride?)` — preserve the existing
    explicit `+/−` behavior from `dashboard/shared.tsx`.
  - `fractionDigits(currencyOverride?)` — exposes `currencyFractionDigits` for
    input components.
- Backed **entirely** by `@alga-psa/core` formatters — no local `Intl.NumberFormat`,
  no `/100`, no `dp` default that assumes 2 decimals.

**Rebase the dashboard module** `packages/inventory/src/components/dashboard/shared.tsx`:

- Delete `buildCurrencyFormat`, the local `CurrencyFormatContext`,
  `CurrencyFormatProvider`, and `useCurrencyFormat` (lines ~24-81).
- Re-export `CurrencyFormatProvider` / `useCurrencyFormat` / `CurrencyFormat`
  from the new `@alga-psa/ui` module so the ~9 existing dashboard call sites
  (`RailTiles`, `MoneyBand`, `FooterStrip`, `AttentionStream`, `InventoryDashboard`,
  `MarginReport`) keep working unchanged.
- **Intended behavior change:** dashboard money currently renders whole-number
  (`dp=0`); under the core formatter it renders the currency's natural fraction
  digits (e.g. USD `$1,234.00`, JPY `¥1,234`). This is the desired result — do
  **not** reintroduce a hardcoded exponent or a whole-number override.

**Delete these local helpers** and route them through the hook (or, for
non-component code, `formatCurrencyFromMinorUnits` directly):

| File | Local helper (line) |
|---|---|
| `PurchaseOrdersManager.tsx` | `money` (82) |
| `PoLandedCostDialog.tsx` | `money` (14) |
| `VendorBillsManager.tsx` | `money` (34) — also called with NO currency at 432/447 |
| `ImportOpeningBalances.tsx` | `dollars` (30) |
| `StockOverview.tsx` | `dollars` (48) |
| `WriteOffsReport.tsx` | `money` (19) |
| `SalesOrderDetail.tsx` | `dollars` (71) |
| `CycleCountsManager.tsx` | `dollars` (29) |
| `StockUnitsManager.tsx` | `fmtCents` (36) |
| `MarginReport.tsx` | (already on hook; ensure no residual `$`) |
| `SalesOrdersManager.tsx` | already imports core formatters — finish migration to hook where inside a provider |

Each call site must pass the correct `currency_code` — from the record for list
rows, or from the provider for single-currency pages (§6 supplies the codes).

---

## 5. Layer 2 — `resolveTenantCurrency` (server default resolver)

**Create** a shared server helper (co-located with the inventory server libs, or a
shared server util module):

```ts
async function resolveTenantCurrency(knex: Knex, tenant: string): Promise<string> {
  const row = await tenantDb(knex, tenant)
    .table('default_billing_settings')
    .select('default_currency_code')
    .first();
  return row?.default_currency_code || 'USD';
}
```

- Replace the ~30 hardcoded `'USD'` **write-defaults** and payload defaults in
  inventory actions/lib with a call to this resolver (only where a currency is
  not already known from the record). Target files:
  `vendorProductActions.ts:84`, `vendorBillActions.ts:178`, `reorderActions.ts:163`,
  `dropShipActions.ts:55`, `rmaActions.ts:137`,
  `productInventorySettingsActions.ts:133`, `landedCostActions.ts:69`,
  `cycleCountActions.ts`, `inventoryDashboardActions.ts`,
  `lib/materials.ts:156`, `lib/openingBalanceCsv.ts:624`, `lib/dashboardQueries.ts:8`.
- **Leave billing untouched.** Drop one marker at
  `packages/billing/src/actions/profitabilityReportActions.ts:305`:
  `// LEVERAGE: friction tenant-default-currency — duplicate of inventory resolveTenantCurrency; consolidate into a shared server util.`

> Note: `'USD'` also appears in ~15 inventory **test** files — those are fixtures,
> leave them. Only production write/display paths change.

---

## 6. Consuming sweep — the three surfaces

### 6a. Entry screens
- Money fields → shared `CurrencyInput` (removes `step="0.01"` raw inputs at
  `LoanersManager.tsx:305`, `StockOverview.tsx:428`, `PurchaseOrdersManager.tsx:697`,
  `SalesOrdersManager.tsx:650`, `PoLandedCostDialog`).
- Currency pickers → shared `CURRENCY_OPTIONS` dropdown:
  - `VendorPriceList.tsx:218` — **replace the free-typed currency text field**
    with the dropdown (stops persisting invalid codes).
  - `PurchaseOrdersManager.tsx:135` — delete the local 4-item `CURRENCY_OPTIONS`,
    use the shared one.
- Writes convert major→minor via `toMinorUnits(value, locale, currency)`,
  replacing `Math.round(x * 100)` (`PurchaseOrdersManager.tsx:267`,
  `PoLandedCostDialog`, `openingBalanceCsv.ts` parse) and any `* 100`.
- Form defaults: seed `currency_code` from `resolveTenantCurrency` (server) or the
  provider (client), not `'USD'` (`PurchaseOrdersManager.tsx:60`, `VendorPriceList`,
  `PoLandedCostDialog`).

### 6b. Displays
- All money via `useCurrencyFormat()` / core formatter (§4).
- Fix hardcoded-symbol column headers, e.g. `PurchaseOrdersManager.tsx:667`
  `Unit cost ($)` → neutral `Unit cost` (currency shown in the value).

### 6c. Defaults / payloads
- Thread `currency_code` onto report and query payloads that currently drop it,
  so display sites have a real code:
  - `inventoryReportingActions.ts:48` — `InventoryValueReport`, `MarginReport`,
    `WriteOffReportData`.
  - `salesOrderLinkActions.ts:74`.
  - `lib/dashboardQueries.ts:8`.
  Where a report spans a single tenant currency, carry
  `resolveTenantCurrency(...)`; where rows carry their own code, include it
  per-row and format with the override argument.

---

## 7. Mixing enforcement (exactly two sites)

Currency lives on document **headers**; most lines inherit it, so mixing is
usually impossible. `sales_order_lines` and `vendor_bill_lines` have **no**
currency column — single-currency by construction, nothing to enforce. The two
real sites:

1. **Purchase order lines** — `purchase_order_lines.cost_currency` can diverge
   from `purchase_orders.currency_code`.
   - UI: PO header has the single currency selector; **remove any per-line
     currency choice**; lines inherit the header currency.
   - Server (PO create/update in `PurchaseOrdersManager` action path): write every
     line's `cost_currency = header currency_code`; **validate equal on save** and
     reject a divergent mix with a clear error.
2. **Landed costs** — `po_landed_costs.currency_code` can diverge from its parent
   PO.
   - UI (`PoLandedCostDialog`): default and **lock** the currency to the parent
     PO's `currency_code` (display it, don't offer a different pick).
   - Server (`landedCostActions.ts`): validate the landed cost currency equals the
     parent PO currency; reject otherwise.

Cross-*document* rollups (`PurchaseOrdersManager.tsx:514-515` `openTotal`,
dashboard `MoneyBand`/tiles) simply format in the tenant default currency and
make no cross-currency arithmetic claim — no grouping UI, no conversion.

---

## 8. Reference implementation order

Do PO end-to-end first as the worked example, then sweep outward.

1. **Layer 1** — build/promote `useCurrencyFormat` in `packages/ui`; rebase
   `dashboard/shared.tsx` onto it; verify dashboard still renders correctly.
2. **Layer 2** — build `resolveTenantCurrency`; add the billing `LEVERAGE` marker.
3. **Purchase Order** end-to-end (`PurchaseOrdersManager` + `PoLandedCostDialog` +
   `landedCostActions`) using both layers + `CurrencyInput` + shared
   `CURRENCY_OPTIONS` + mixing enforcement. This is the pattern every other file
   copies.
4. **Persisted `'USD'` write-defaults** in actions/lib (highest data risk).
5. **Payload `currency_code` threading** (unblocks downstream displays).
6. **Remaining display helpers + form inputs** onto the hook / `CurrencyInput` /
   `CURRENCY_OPTIONS`.

Files confirmed **already clean** (do not touch): dashboard `RailTiles` /
`AttentionStream` / `FooterStrip` / `MoneyBand`, `VendorsManager`,
`GhostUsageReport`, `RmaManager`, `TransfersManager`, `StockLocationsManager`,
`KitManager`, the `msp/inventory` pages, and both inventory API routes.

---

## 9. Testing / verification

- **Unit:** `toMinorUnits` / `formatCurrencyFromMinorUnits` round-trip for USD (2),
  JPY (0), BHD (3) — assert no `×100` corruption for JPY.
- **Component:** a display site formats a non-USD `currency_code` with the correct
  symbol and fraction digits; PO list rows in different currencies each render
  their own code via the `money(minor, override)` path.
- **Enforcement:** PO save rejects a line whose `cost_currency` ≠ header; landed
  cost save rejects a currency ≠ parent PO.
- **Resolver:** `resolveTenantCurrency` returns the tenant's
  `default_currency_code`, falls back to `'USD'` when unset.
- **Manual (`/verify`-style):** create a PO in a non-USD currency, add a line and a
  landed cost, confirm entry (locale-aware input), storage (correct minor units),
  and display (correct symbol/decimals) end-to-end. Confirm the dashboard tiles
  and margin/write-off reports still render after the `shared.tsx` rebase.
- **Assumption check:** query distinct `currency_code` / `cost_currency` across
  inventory tables to confirm the forward-only (no-backfill) assumption holds.

## 10. Out of scope

Exchange rates / FX conversion, mixed-currency grouping UI, data backfill
migrations, billing-side adoption (marker only), and the inventory `*.test.ts`
`'USD'` fixtures.
