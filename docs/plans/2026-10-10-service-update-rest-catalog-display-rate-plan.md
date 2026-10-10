# Plan: setting service catalog prices through the REST API (alga0002016)

Base: `origin/main` b0d0b4dacf. Branch: `feature/alga0002016-service-update-via-rest-ignores-pric`.

## Problem

`PUT /api/v1/services/{id}` drops a `prices` array without an error, and no REST
endpoint writes `service_prices`. The Service Catalog shows `prices[0]` and falls
back to `default_rate` only when a service has no price rows
(`ServiceCatalogManager.tsx` ~852-870). Once a service has a price row, its
displayed rate can only be changed from the in-app Service form.

## What the current code does

**Request validation.** `ApiServiceController` validates with
`server/src/lib/api/schemas/serviceSchemas.ts`, not `financialSchemas.ts` (the
card names the wrong file). The `financialSchemas.ts` service schemas are not
imported by the services routes. `serviceShape` has no `prices` field and is
non-strict, so zod strips `prices`. Because of the "at least one field" refine,
a body with only `{prices}` returns 400. A body with `{default_rate, prices}`
returns 200 and loses the prices.

**API service.** `ServiceCatalogService.create()` and `.update()`
(`server/src/lib/api/services/ServiceCatalogService.ts:233-325`) remove `prices` and
`currency_code` before writing. `update()` does a raw `service_catalog` update
outside a transaction and never touches `service_prices`.

**Domain writers.** There are four writers for the same table, and they behave
differently:

| Writer | Used by | Current-window semantics | Syncs `default_rate` | Billing lock | Txn |
|---|---|---|---|---|---|
| `Service.setPrices` (`packages/billing/src/models/service.ts:1009`) via `updateServicePricing` | Service form, ordinary save | Deletes **all** rows with `effective_date <= today`, inserts the list at the epoch | Yes, in `updateServicePricing` (`prices[0]`) | No | Yes |
| `applyServicePriceChange` (`packages/billing/src/actions/servicePriceRolloutActions.ts:463`) | Service form, rollout dialog | Immediate: per **submitted currency**, delete `<= today` and insert at the epoch. Future: upsert on `(tenant, service_id, currency_code, effective_date)` | Yes when immediate; no when future | `lockTenantBilling` | Yes |
| `setServicePrices` action → `Service.setPrices` | QuickAddService / QuickAddProduct after create | Same as row 1 | **No** | No | Separate from the create |
| `ProductCatalogService.setServicePrices` (private) | `POST/PUT /api/v1/products` | Same as row 1 | **No** | No | Create: yes. Update: **no** |

**Primary price order.** "Primary price" means `prices[0]`. The catalog reads
(`ServiceCatalogService.list/getById`, `Service.getAll/getById`,
`ProductCatalogService`) select `service_prices` without an `ORDER BY`, and
`splitServicePricesByEffectiveDate` keeps the order the rows arrive in. Postgres
row order is therefore what decides which currency is primary. Today that order
happens to follow insertion order, but nothing guarantees it, especially on
Citus after rows have been updated. `Service.getPrices` sorts by
`currency_code`, which is a third, unrelated ordering.

**Currency configuration.** The UI offers `CURRENCY_OPTIONS` from `@alga-psa/core`
and seeds the first row from `default_billing_settings.default_currency_code`.
Tenants do not have a list of enabled currencies.

**Units.** `service_prices.rate` and `service_catalog.default_rate` are both
integer minor units (cents). The form saves `rate` as cents and mirrors it into
`default_rate`.

## Design decisions

### D1. Accept `prices` on the existing create/update endpoints, not a `/prices` sub-resource

The UI saves service fields and prices in one atomic action
(`updateServicePricing`). The read shape already returns `prices` and
`scheduled_prices` on the service resource, and `/api/v1/products` already
accepts `prices` inline. Accepting them inline on `POST /api/v1/services` and
`PUT /api/v1/services/{id}` keeps reads and writes symmetric (GET → edit → PUT),
keeps the single-transaction guarantee, and matches the products API. A separate
`/prices` resource would split one save into two requests that cannot share a
transaction, which is the divergence `updateServicePricing` was written to
prevent.

### D2. Two write fields that mirror the read split, each replacing its own window

- `prices: [{ currency_code, rate }]` replaces the **current window**: every row
  with `effective_date <= today`, for all currencies. Rows are written at the
  epoch (`1970-01-01`), as the form does. Omitted currencies are removed. This
  is the form's ordinary save (`Service.setPrices`) and the products API's
  behavior.
- `scheduled_prices: [{ currency_code, rate, effective_date }]` replaces the
  **future window**: every row with `effective_date > today`. Each entry must
  have `effective_date > today` (calendar date, `YYYY-MM-DD`); otherwise the
  request fails with 400. `[]` cancels all scheduled changes.
- Leaving a field out leaves its window unchanged. Sending `prices` without
  `scheduled_prices` leaves scheduled increases alone, keeping the existing
  guarantee that "an ordinary save must not revoke a scheduled increase."
- Every write takes `lockTenantBilling` in the transaction, as
  `applyServicePriceChange` does. A catalog price change affects inherited
  contract lines, so it has to be serialized with billing runs.

Validation (400, never stripped):

- `currency_code` must be one of `CURRENCY_OPTIONS` values. The list is imported,
  not hardcoded, and is the same set the form allows.
- Currencies must be unique within `prices`. Within `scheduled_prices`, each
  `(currency_code, effective_date)` pair must be unique.
- `rate` must be an integer ≥ 0 in minor units. Fractional values are rejected
  rather than rounded, because silently rounding a REST value is the kind of
  quiet change this ticket is about.
- Round-trip tolerance: price items may carry the read-only echo fields
  `price_id`, `service_id`, `tenant`, `created_at`, `updated_at`, and (for
  `prices`) `effective_date`, so a GET response can be PUT back. These fields are
  ignored. An `effective_date` inside `prices` that is later than today returns
  400 with "use scheduled_prices". All other unknown keys inside a price item
  return 400 (`.strict()` after removing the echo fields).

### D3. `default_rate` mirrors the primary current price, and the server enforces it

- When `prices` is sent with at least one row, `default_rate` is set to
  `prices[0].rate`, as `updateServicePricing` does. If the request also sends a
  `default_rate` that differs, the server returns **400** instead of choosing one.
- When `prices: []` is sent, the price rows are cleared and `default_rate` is
  left alone. The catalog then shows `default_rate`, as it already does for
  services with no price rows.
- When `default_rate` is sent without `prices` and the service has current price
  rows, the server rewrites the **primary** current row (the one displayed) to
  that rate, in the same currency. This fixes the second half of the ticket:
  "setting `default_rate` alone does not change the displayed rate." Without
  price rows, the behavior is unchanged: only `default_rate` is written.
- `scheduled_prices` never changes `default_rate`, matching
  `applyServicePriceChange` when the effective date is in the future.
- Create: `default_rate` becomes optional when `prices` is non-empty, and is
  derived from it. A create with neither `prices` nor `default_rate` returns 400.
  A create with only `default_rate` behaves as it does today (no price rows),
  which the catalog displays correctly.

### D4. One domain writer in `packages/billing`, used by every caller

Add `writeServiceCatalogPricing(trx, tenant, serviceId, input)` in
`packages/billing/src/lib/catalog/serviceCatalogPricing.ts`, exported through
the package `exports`. It:

1. Takes `lockTenantBilling(trx, tenant)`.
2. Validates as described in D2 and D3 (shared with the zod schema through
   `servicePriceInputSchema` and `scheduledServicePriceInputSchema`, exported
   from the same module).
3. Replaces the current window when `current` is given.
4. Replaces the future window when `scheduled` is given, or upserts at one date
   when `scheduledAt` is given (the rollout dialog's per-date write).
5. Works out the `default_rate` mirror as in D3 and returns it as a field patch
   for `Service.update`, so all service-field normalization stays in one place.
6. Returns the written rows.

Callers to move onto it:

- `ServiceCatalogService.create`/`.update`: the REST path. `update` moves into
  `withTransaction` and returns 404 before writing any prices when the row is
  missing.
- `updateServicePricing` (`serviceActions.ts:1395`).
- `applyServicePriceChange`, for both the immediate and the future branch. The
  immediate branch changes from replacing only submitted currencies to replacing
  the whole current window. The form always submits the full list, so the
  result is the same in practice, and the two save buttons now share one rule.
- `setServicePrices`, so QuickAdd syncs `default_rate`. Also make QuickAdd's
  create+price a single action, `createServiceWithPricing`, so a failed price
  write cannot leave behind a service with no prices.
- `ProductCatalogService.create`/`.update` (delete its private
  `setServicePrices`). The products API gains the `default_rate` mirror, the
  billing lock, and a transaction on update. Product `scheduled_prices` comes
  free through the shared schema.
- `Service.setPrices` and `Service.setPrice` stay as thin delegates, or are
  removed if a grep shows no remaining callers.

This fixes the duplicated price-writing logic instead of adding a fifth writer.
If anything has to stay duplicated, mark it with a `// LEVERAGE: pattern
catalog-price-writer` comment. The goal is that nothing does.

### D5. Store an explicit primary order on price rows

The API contract in D3 ("`prices[0]` is primary and drives `default_rate`") and
the catalog display both depend on row order, which is currently undefined.
Add a migration:

- `service_prices.display_order smallint not null default 0`.
- Backfill each `(tenant, service_id, effective window)`: the row whose
  currency's rate equals `service_catalog.default_rate` gets 0. If no row
  matches, the tenant-default-currency row gets 0. Any remaining rows are
  numbered by `currency_code`, starting at 1.
- The writer sets `display_order` from the array index (the future window uses
  the index within each `effective_date`).
- Every `service_prices` read that feeds `prices` / `scheduled_prices` sorts by
  `display_order, currency_code`: `ServiceCatalogService`,
  `ProductCatalogService`, `Service.getAll/getById/getPrices`,
  `serviceActions.getServices`. `splitServicePricesByEffectiveDate` keeps input
  order, so `current` comes out in primary order.
- Run the migration through `server/migrations/utils/tenantDb.cjs`.
  `service_prices` is already registered there and is distributed by `tenant`.
  Adding a column with a default is safe on Citus.

### D6. Never drop unknown write fields on this endpoint

`currency_code` at the top level of a service body (currently stripped by
`ServiceCatalogService`) returns 400 with "use prices[].currency_code". The
service schemas stay non-strict for other keys, so existing clients that echo
the read model still work. That is a separate change. The `prices` and
`scheduled_prices` keys are now handled, which closes the reported silent drop.

## API contract (documented in OpenAPI)

```jsonc
// PUT /api/v1/services/{id}
{
  "service_name": "Managed Endpoint",          // any existing optional fields
  "prices": [                                   // optional; replaces current window
    { "currency_code": "USD", "rate": 12500 },  // [0] is primary → default_rate
    { "currency_code": "EUR", "rate": 11500 }
  ],
  "scheduled_prices": [                         // optional; replaces future window
    { "currency_code": "USD", "rate": 13500, "effective_date": "2027-01-01" }
  ]
}
```

The response is the existing `ServiceEnvelope`, with `prices` and
`scheduled_prices` read back in `display_order`.

## Files to change

| File | Change |
|---|---|
| `packages/billing/src/lib/catalog/serviceCatalogPricing.ts` (new) | Domain writer and the shared zod item schemas (D2, D3, D4) |
| `packages/billing/package.json` | Export the new module |
| `packages/billing/src/models/service.ts` | Order price reads by `display_order`; `setPrices`/`setPrice` delegate to the writer or are removed; `serviceSchema` gains `display_order` |
| `packages/billing/src/actions/serviceActions.ts` | `updateServicePricing` and `setServicePrices` use the writer; add `createServiceWithPricing`; order `getServices` price reads |
| `packages/billing/src/actions/servicePriceRolloutActions.ts` | `applyServicePriceChange` uses the writer for both branches |
| `packages/billing/src/components/settings/billing/QuickAddService.tsx`, `QuickAddProduct.tsx` | Call `createServiceWithPricing` (one transaction) |
| `server/src/lib/api/schemas/serviceSchemas.ts` | Add `prices` and `scheduled_prices`; make `default_rate` optional on create when `prices` is present; add the D3 conflict refine and the D6 `currency_code` rejection |
| `server/src/lib/api/schemas/productSchemas.ts` | Reuse the shared price item schemas; add `scheduled_prices` |
| `server/src/lib/api/services/ServiceCatalogService.ts` | `create`/`update` call the writer in one transaction; 404 before writing; order reads; add `prices` to the event's `changedFields` |
| `server/src/lib/api/services/ProductCatalogService.ts` | Delete the private writer and use the domain writer; wrap update in a transaction; order reads |
| `server/src/lib/api/openapi/routes/services.ts` (+ `products.ts`) | Request bodies document `prices`/`scheduled_prices` (`.describe` on minor units, primary = index 0, window-replace semantics, `CURRENCY_OPTIONS`); PUT/POST descriptions explain the `default_rate` mirror; `ServicePrice` gains `display_order`; 400 descriptions list the conflict cases |
| `server/migrations/<ts>_service_prices_display_order.cjs` (new) | D5 column and backfill |
| `sdk/docs/openapi/alga-openapi*.{json,yaml}`, `docs/openapi/*.json` | Regenerate with `npm -w sdk run openapi:generate` |
| `server/src/lib/api/schemas/financialSchemas.ts` | Not used by the services routes. Leave it as is; a grep confirmed it has no service-route consumers |

## Tests

Integration tests (`server/src/test/integration/billing/`, extending
`catalogApiScheduledPrices.integration.test.ts` or adding
`catalogApiPriceWrites.integration.test.ts`):

1. PUT `{prices:[USD 12500]}` on a service that has a USD row: the row is
   replaced, `default_rate` is 12500, and GET shows `prices[0].rate` 12500.
   This is the ticket's scenario.
2. PUT `{default_rate: 9900}` only, on a service with USD and EUR rows: the
   primary (USD) row becomes 9900, EUR is unchanged, and the display rate
   changes.
3. PUT `{default_rate: 1, prices:[USD 2]}` returns 400 and writes nothing.
4. PUT `prices` with an unsupported currency, a duplicate currency, a
   fractional or negative rate, or a future `effective_date` returns 400, and
   the database is unchanged.
5. PUT `prices` alone keeps an existing scheduled row. PUT `scheduled_prices: []`
   removes it. PUT `scheduled_prices` with a past date returns 400.
6. PUT `scheduled_prices` does not change `default_rate`.
7. POST with `prices` and no `default_rate` creates the rows and derives
   `default_rate`. POST with neither returns 400.
8. A GET → PUT round trip with read echo fields succeeds and is idempotent.
9. `display_order` is stable: insert EUR then USD with USD primary, update rows,
   and `prices[0]` is still USD.
10. Products API: PUT `prices` now syncs `default_rate`, and update is
    transactional (a forced failure after the catalog write leaves no partial
    state).
11. Tenant isolation: tenant B cannot write tenant A's prices; this follows the
    pattern in `catalogServicesTenantScoped.contract.test.ts`.

Unit tests: the writer's validation and `default_rate` derivation; the schema
refines; the migration backfill on fixtures (default-rate match, fallback to the
tenant default currency, ordering by currency).

Regression: run the existing `servicePriceRollout`, `serviceActions`, and
catalog test suites, plus `defaultTaxRateCatalogEntrypoints`.

Manual smoke test on the dev server (`http://feature-alga0002016-service-update-via-rest-ignores-pric.localhost:3588`):
change a service's price with `PUT` using an API key, then confirm that
Settings → Billing → Service Catalog shows the new rate and that the edit dialog
opens with the same rows in the same order.

## Out of scope / follow-ups

- Making every REST write schema strict across the API.
- Tenant-level lists of enabled currencies. None exist today. If they are
  added, validation should switch from `CURRENCY_OPTIONS` to that list in the
  shared schema only.
- The unused service schemas in `financialSchemas.ts` could be removed in a
  cleanup pass.
