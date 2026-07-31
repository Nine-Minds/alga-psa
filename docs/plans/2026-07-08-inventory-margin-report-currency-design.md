# Inventory Margin Report — Currency Fix (Design)

**Date:** 2026-07-08
**Branch:** `fix/inventory-margin-report-currency`

## Problem

The Margin Report screen (`packages/inventory/src/components/MarginReport.tsx`) formats
every money value with a hardcoded helper:

```ts
const money = (cents) => `$${(Number(cents ?? 0) / 100).toFixed(2)}`;
```

A tenant configured for a non-USD currency (EUR, GBP, …) still sees a `$` sign and a
US-style number format across all revenue / COGS / margin cells and the four total tiles.
The margin math is correct; only the display currency is wrong.

## Fix

Reuse the currency layer the inventory **dashboard** already established — no new
abstractions.

### 1. Server action — `marginReport` (`packages/inventory/src/actions/inventoryReportingActions.ts`)

- Resolve the tenant currency from `default_billing_settings.default_currency_code`
  (fallback `'USD'`), identical to `inventoryDashboardActions.ts:208-212`.
- Add `currency_code: string` to the `MarginReport` interface and include it in the
  returned object.

### 2. Component — `MarginReport.tsx`

- Delete the local `money` helper.
- Wrap the rendered report in
  `<CurrencyFormatProvider currencyCode={report.currency_code} locale={i18n.language}>`
  (imported from `./dashboard/shared`).
- Format all money cells and total tiles via `useCurrencyFormat().money(cents, 2)`.
  Because the hook must be called *under* the provider, the report body (table +
  totals) moves into a small inner component rendered inside the provider.
- The `pct` helper is unaffected.
- Keep **2 decimal places** (`dp=2`), preserving the report's current precision. (The
  dashboard's `money` defaults to whole numbers, but the shared formatter already
  accepts a `dp` argument.)

## Data Flow

`marginReport()` → `{ rows, total_*_cents, currency_code }` → `CurrencyFormatProvider`
→ `Intl.NumberFormat(locale, { style: 'currency', currency })` → e.g. `€1.234,56`.

## Out of Scope / Accepted Limitation

Figures are shown in the tenant's default currency even when the underlying sales
orders span multiple currencies. This matches the dashboard's existing behavior; a
mixed-currency guard was explicitly deferred.

## Testing

- **Unit:** extend `packages/inventory/src/actions/inventoryReportingActions.test.ts`
  to assert `marginReport` returns the tenant's `default_currency_code`.
- **Manual:** on the running dev stack, set the tenant billing currency to a non-USD
  value and confirm the Margin Report renders that currency's symbol and formatting.

## Files Touched

- `packages/inventory/src/actions/inventoryReportingActions.ts`
- `packages/inventory/src/components/MarginReport.tsx`
- `packages/inventory/src/actions/inventoryReportingActions.test.ts` (test addition)
