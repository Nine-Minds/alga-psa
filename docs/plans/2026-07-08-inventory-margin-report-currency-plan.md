# Inventory Margin Report — Currency Fix (Implementation Plan)

**Date:** 2026-07-08
**Branch:** `fix/inventory-margin-report-currency`
**Design:** `docs/plans/2026-07-08-inventory-margin-report-currency-design.md`

## Summary

Replace the hardcoded `$`/`/100` money formatter in the Margin Report with the
currency layer the inventory dashboard already uses: resolve the tenant's
`default_billing_settings.default_currency_code` in the server action and format
through `CurrencyFormatProvider` / `useCurrencyFormat` in the component.

## Reference implementation (mirror this)

- Currency resolution: `packages/inventory/src/actions/inventoryDashboardActions.ts:208-212`
- Provider + hook usage split: `packages/inventory/src/components/InventoryDashboard.tsx:70-81`
- Shared formatter: `packages/inventory/src/components/dashboard/shared.tsx:33-81`

## Step 1 — Server action returns `currency_code`

File: `packages/inventory/src/actions/inventoryReportingActions.ts`

1. Add `currency_code: string;` to the `MarginReport` interface (after
   `total_margin_pct`).
2. Inside the `marginReport` transaction (after `rows`/totals are computed, before the
   `return`), resolve the currency exactly as the dashboard does:
   ```ts
   const billingSettingsRow = await trx('default_billing_settings')
     .where({ tenant })
     .select<{ default_currency_code: string | null }>('default_currency_code')
     .first();
   const currency_code = billingSettingsRow?.default_currency_code || 'USD';
   ```
   Match the dashboard's actual query builder/tenant-scoping idiom used at
   `inventoryDashboardActions.ts:208-212` (use `scopedDb`/`tenantDb` if that is what the
   surrounding code uses; confirm the exact form when editing).
3. Add `currency_code` to the returned object.

## Step 2 — Component formats via the provider

File: `packages/inventory/src/components/MarginReport.tsx`

1. Remove the module-level `money` helper (lines 17-18).
2. Import the provider + hook:
   ```ts
   import { CurrencyFormatProvider, useCurrencyFormat } from './dashboard/shared';
   ```
3. Split the component so the hook is called under the provider (mirror
   `InventoryDashboard.tsx`):
   - Outer `MarginReport` keeps state (`report`, `loading`, `from`, `to`, `run`,
     `useEffect`) and the header/filter controls. It reads
     `const { t, i18n } = useTranslation('features/inventory')`.
   - Wrap the parts that render money (the totals grid and the `DataTable`) in:
     ```tsx
     <CurrencyFormatProvider
       currencyCode={report?.currency_code ?? 'USD'}
       locale={i18n.language || 'en'}
     >
       …money-rendering body…
     </CurrencyFormatProvider>
     ```
     Place the provider so it wraps both the totals tiles and the table. The simplest
     shape: extract a `MarginReportBody`/inner render that takes `report` + `t` and
     calls `const { money } = useCurrencyFormat();`, then builds `columns` and the
     totals tiles using `money(v, 2)`.
4. Replace every `money(v)` / `money(report.total_*_cents)` call with `money(v, 2)` from
   the hook (2 decimals preserves current precision).
5. Leave the `pct` helper, the empty/loading states, the date inputs, and the refresh
   button unchanged.

Note: `columns` currently closes over the module `money`. After the change it must be
built inside the component/inner render that has the hook value in scope.

## Step 3 — Test

File: `packages/inventory/src/actions/inventoryReportingActions.test.ts`

- Add/extend a `marginReport` case asserting the returned object includes
  `currency_code` equal to the tenant's configured `default_currency_code` (and that it
  falls back to `'USD'` when no billing settings row exists). Follow the existing test's
  tenant/seed setup conventions in that file.

## Step 4 — Verify

- Typecheck / build the `inventory` package.
- On the running dev stack (port 3237): set the tenant's billing default currency to a
  non-USD value (e.g. EUR), open **Inventory → Margin Report**, and confirm all cells
  and total tiles render the correct symbol/format (e.g. `€1.234,56`). Confirm a USD
  tenant is unchanged.

## Acceptance Criteria

- Margin Report renders all money values in the tenant's `default_currency_code` via
  `Intl.NumberFormat`, with 2 decimal places.
- No hardcoded `$` or `/100` remains in `MarginReport.tsx`.
- `marginReport` action returns `currency_code`.
- Test asserts the returned `currency_code`.
- Margin math, SQL, date filtering, and `margin_pct` display are unchanged.

## Out of Scope

- Mixed-currency handling across sales orders (deferred; matches dashboard behavior).
- Any change to how `default_currency_code` itself is configured.
