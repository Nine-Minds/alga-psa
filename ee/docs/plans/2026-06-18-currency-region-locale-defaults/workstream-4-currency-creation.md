# Workstream 4 — Apply the org default currency at creation time (root cause)

**Owner:** agent-currency-create
**Goal:** This is the real cure. The org default (`default_billing_settings.default_currency_code`) is only
a last-resort fallback today and is never written onto new records. Make new clients (and the billing-config
UI) adopt the resolved org default instead of a literal `'USD'`, so downstream `... || 'USD'` fallbacks stop
firing for correctly-configured tenants.

**Owned files (edit only these):**
- `packages/clients/src/actions/clientActions.ts`
- `packages/clients/src/components/clients/BillingConfiguration.tsx`
- `packages/clients/src/components/clients/BillingConfigForm.tsx`
- `shared/workflow/runtime/actions/businessOperations/clients.ts`
- `packages/billing/src/actions/manualInvoiceActions.ts`

**Reference (read, don't edit):**
- `packages/billing/src/actions/billingCurrencyActions.ts` → `resolveClientBillingCurrency` and any helper
  that reads `default_billing_settings.default_currency_code`. Reuse the tenant-default read; don't
  duplicate the literal `'USD'`.

## Tasks

- [x] **clientActions.ts — client creation** — Done in BOTH create paths. `createClient` (~344): when
      `clientData.default_currency_code` is falsy, read `default_billing_settings.default_currency_code` with
      the in-scope tenant-scoped `knex` (awaited, before the transaction) and set it on the insert; `'USD'`
      only as final fallback. CSV import path `importClientsFromCSV` (~1655): the `clientToCreate` object
      previously omitted `default_currency_code` entirely (inserted null) — added
      `default_currency_code: clientData.default_currency_code || tenantDefaultCurrencyCode`, where the tenant
      default is read ONCE before the per-row loop (avoids a query per CSV row). NOTE: `country_code: 'US'`
      (~1672, default client_location on CSV import) left unchanged — deferred to DD-1/wave 2 per instruction.
- [x] **shared/.../businessOperations/clients.ts ~1172** — Replaced `input.default_currency_code ?? 'USD'`
      with `input.default_currency_code ?? (await getTenantDefaultBillingCurrency(tx))`. Added a worker-context
      helper `getTenantDefaultBillingCurrency(tx)` (next to `getDefaultInteractionStatusId`) that reads
      `default_billing_settings` via the in-scope `tx.trx`/`tx.tenantId` (the same connection used everywhere
      in this file) — no server-action wrapper imported, so it resolves in the worker. `'USD'` kept as final
      fallback. Verified the later `directPatch` (~1200) cannot clobber this: `pickExistingFields` drops
      `undefined`, so when `input.default_currency_code` is unset the patch omits the column entirely.
- [x] **BillingConfiguration.tsx ~52** & **BillingConfigForm.tsx ~217** — Chose the **fetch** option (lower
      risk than a prop: the parent `ClientDetails.tsx`/`ContractDialog.tsx` are NOT owned files, so a prop
      would require editing them and would no-op until wired). `BillingConfiguration.tsx` now imports the
      existing `getDefaultBillingSettings` server action from `@alga-psa/billing/actions` (which itself reads
      `default_billing_settings` — no duplicated `'USD'` literal at the source). State init for
      `default_currency_code` changed from `client.default_currency_code || 'USD'` to
      `client.default_currency_code || ''`; the existing data-fetch `useEffect` now, when the client has no
      currency, awaits the tenant default and patches `billingConfig` (guarded so it never overwrites an
      already-set value; on error falls back to `'USD'`). Render stays synchronous — only the effect is async.
      `BillingConfigForm.tsx` consumes the resolved value via the existing `billingConfig` prop; its `|| 'USD'`
      is now only a transient last-resort while the parent's async value loads (clarifying comment added).
- [x] **manualInvoiceActions.ts ~84** — Replaced the trailing `|| 'USD'`. Now computes
      `currencyCode = request.currency_code || client.default_currency_code`, and only if still falsy reads
      `default_billing_settings.default_currency_code` via the in-scope tenant `knex` (awaited), `'USD'` final
      fallback; `invoice.currency_code` is set to `currencyCode`. Deliberately did NOT call
      `resolveClientBillingCurrency` here: that resolver also inspects active-contract currencies and THROWS on
      multi-currency conflicts, which would change manual-invoice semantics. Replicating only the tenant-default
      read preserves the existing precedence (request → client → tenant default → 'USD'). Flag for sign-off if
      contract-aware resolution is actually desired here.

## Coordinate / flag

- [x] **DD-3 (data backfill):** RECOMMENDATION (no migration written, needs sign-off): existing rows with
      `clients.default_currency_code IS NULL` are unaffected by this workstream and will still fall through to
      `'USD'` via downstream `... || 'USD'` fallbacks. Recommend a one-time, tenant-scoped backfill migration
      that, per tenant, sets `clients.default_currency_code = default_billing_settings.default_currency_code`
      (joined on `tenant`) WHERE `clients.default_currency_code IS NULL`, defaulting to `'USD'` only where a
      tenant has no `default_billing_settings` row / null `default_currency_code`. Must be CitusDB-safe: scope
      every statement by `tenant` and join on `tenant` (no cross-shard updates). Do not run without sign-off.

## Verification

- [x] No new sync→async breakage. Every new DB read is `await`ed: `clientActions.createClient` and
      `importClientsFromCSV` (awaited before/around the transaction), `manualInvoiceActions` (awaited before
      invoice object build), workflow `getTenantDefaultBillingCurrency` (awaited at the call site). No React
      render function was made async — only the existing `useEffect` callback in `BillingConfiguration.tsx`,
      which was already async.
- [x] Type-checked all three packages (`npx tsc --noEmit`): `packages/billing` → exit 0, 0 errors;
      `packages/clients` → exit 0, 0 errors (confirms the new `@alga-psa/billing/actions` import resolves);
      `shared` → exit 0, 0 errors.

## Notes (agent fills in)

- **Summary:** Implemented the root-cause currency fix across all 5 owned files. New clients (UI create via
  `createClient`, CSV import, and workflow `clients.create`) and manual invoices now adopt the tenant's
  configured default currency (`default_billing_settings.default_currency_code`) when no explicit currency is
  given, with `'USD'` retained strictly as the absolute final fallback. No `'USD'` literal was duplicated at a
  new "source of truth" — every new read goes straight to `default_billing_settings` (the same column
  `resolveClientBillingCurrency` uses), and the UI reuses the existing `getDefaultBillingSettings` action.
- **How the tenant default is read per context:**
  - `clientActions.ts` (server action, `'use server'`): direct `knex('default_billing_settings').where({ tenant }).select('default_currency_code').first()` using the in-scope tenant-scoped knex from `createTenantKnex()`.
  - `manualInvoiceActions.ts` (server action): same direct `knex` read, only when no request/client currency.
  - `shared/.../businessOperations/clients.ts` (worker/workflow context): new helper reads via `tx.trx` / `tx.tenantId` (the tenant-scoped transaction already in scope) — no server-only wrapper imported.
  - `BillingConfiguration.tsx` (client component): calls the existing `getDefaultBillingSettings` server action from `@alga-psa/billing/actions` inside its async `useEffect`.
- **Import resolution note:** `@alga-psa/billing/actions` is not declared in `packages/clients/package.json`,
  but this matches the established pattern in this package (e.g. `@alga-psa/tags/actions`,
  `@alga-psa/event-bus/publishers`, `@alga-psa/auth` are all imported in `clientActions.ts` without being
  declared). Resolution works via npm-workspace hoisting + `tsconfig.base.json` path aliases, and the clients
  tsup preset externalizes all `@alga-psa/*` imports (`bundle: false`, `external: [/^@alga-psa\//]`) so the
  prebuilt dist leaves the import for webpack/Next to resolve. `tsc --noEmit` on clients passes.
- **Design sign-off flags:**
  1. `country_code: 'US'` literal in CSV import (`clientActions.ts` ~1672) deliberately left for DD-1/wave 2.
  2. Manual invoice intentionally uses a plain tenant-default read, not `resolveClientBillingCurrency`
     (avoids contract-currency conflict throws). Confirm if contract-aware resolution is wanted.
  3. DD-3 backfill migration recommended but not written — needs sign-off (see Coordinate / flag).
- **Commands run:** `npx tsc --noEmit` in `packages/billing`, `packages/clients`, and `shared` — all exit 0,
  zero errors.
