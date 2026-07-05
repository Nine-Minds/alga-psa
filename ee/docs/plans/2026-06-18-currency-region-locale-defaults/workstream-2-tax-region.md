# Workstream 2 — Tax / Region defaults

**Owner:** agent-tax-region
**Goal:** Stop defaulting tax region to `'US'`. Invoice tax calc and new-client tax setup must use the
client's configured tax region (and, where there's exactly one configured region for the tenant, that one).
Also scope — but do NOT build without sign-off — an org-level "default tax region" setting (DD-1).

**Owned files (edit only these):**
- `server/src/lib/api/services/InvoiceService.ts`
- `shared/billingClients/taxSettings.ts`

**Reference (read, don't edit):**
- `shared/billingClients/clientTax.ts` → `getClientDefaultTaxRegionCode(knexOrTrx, tenant, clientId)`
  returns the client's default region code or `null`. **This is the replacement for the hardcoded `'US'`.**
- `tax_regions` / `tax_rates` / `client_tax_rates` tables (migrations under `server/migrations/`).

**Do NOT touch (already in-flight in working tree):**
- `server/src/lib/utils/clientFormValidation.ts`, `packages/validation/src/lib/clientFormValidation.ts`.

## Tasks

- [x] **InvoiceService.ts ~397** — DONE. Replaced `tax_region: 'US'` with a new private helper
      `resolveTaxRegion(trx, tenant, clientId)` called inside the existing `withTransaction` block (uses
      `trx`, fully async). Helper: (1) `getClientDefaultTaxRegionCode(trx, tenant, clientId)`; (2) else the
      tenant's single active region if exactly one `tax_regions` row has `is_active = true`; (3) else literal
      `'US'` last-resort so calc never throws. Stale TODO comment removed. Import added:
      `import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients';` (canonical barrel,
      same path used in `packages/billing/.../invoiceGeneration.ts`).
- [x] **InvoiceService.ts ~1842** — LEFT AS-IS (now ~1875 after edits). `currencyCode: invoiceRecord.currency_code || 'USD'`
      already prefers the invoice's own persisted `currency_code` and only falls back to `'USD'` when the
      column is null/empty. This is a read-time display fallback on an existing record; correct per spec, no
      change made.
- [x] **taxSettings.ts** `createDefaultTaxSettings` — DONE. Now queries `tax_regions` for active rows: if the
      tenant has exactly one active region, the selected `tax_rates` row is constrained to that region's
      `region_code` (single-region tenant always inherits that region). Otherwise falls back to legacy
      behavior. Selection ordered by `region_code, created_at` for determinism. ⚠ NOTE: neither `tax_regions`
      nor `tax_rates` has an `is_default` column, so "prefer a region marked default" cannot be honored
      today — that is the DD-1 feature; documented inline and below.
- [x] **DD-1 scoping (write-up only, no code):** Written up in Notes → "DD-1 recommendation". Recommended,
      not built.

## Assess-only (DO NOT edit — just confirm + record in Notes)

These hardcode `'US'` but are arguably intentional address/phone UX defaults. Record whether each should be
driven by a future org default-region setting (DD-1) and leave a checkbox for wave 2:
- [x] `packages/clients/src/components/clients/QuickAddClient.tsx` (confirmed `country_code: 'US'` at line 109,
      initial `locationData` state for the address form). **DD-1 candidate.** This is the new-client address
      default; the country picker is editable. Should be seeded from an org default region/country setting in
      wave 2 rather than hardcoded `'US'`. Not edited (not owned).
- [x] `packages/clients/src/components/clients/ClientLocations.tsx` (confirmed at lines 274–275:
      `country_code: 'US'`, `country_name: 'United States'` in `INITIAL_LOCATION_STATE` for a new location
      row). **DD-1 candidate** — same rationale as QuickAddClient. Not edited (not owned).
- [x] `packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts` (confirmed `country_code: 'US'`
      at line 512, server-side default when persisting the onboarding company/location). **DD-1 candidate** but
      *owned by WS4 for edits* — noted only, not touched here.
- [x] `packages/ui/src/components/PhoneInput.tsx` (line 43) / `CountryPicker.tsx` (line 41) — both implement
      `getDefaultCountryFromLocale()`: derive the country from `Intl.DateTimeFormat().resolvedOptions().locale`
      and only fall back to `'US'` if locale detection fails. **NOT a DD-1 candidate / leave as-is:** this is a
      reasonable last-resort UX default for a generic shared input component, and it already adapts to the
      browser locale. An org default-region setting, if added, would be supplied by the *caller* via the
      existing `countryCode` prop, not by changing these primitives. Not edited (not owned).
- [x] `packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx` (lines 249, 264) —
      `inferCountryCode()`: when a phone number has no `+` country prefix it assumes `'US'` (249), and when no
      dialing-code match is found it falls back to `'US'` (264). This is phone-parsing UX heuristics, **not** an
      address/billing region. **Weak DD-1 candidate** — could prefer the org/client default country for the
      no-prefix assumption, but low value; reasonable to leave. Not edited (not owned).

## Verification

- [x] Confirmed `getClientDefaultTaxRegionCode` import path resolves. Used `@alga-psa/shared/billingClients`
      (barrel `index.ts` re-exports `./clientTax`); server `tsconfig.json` maps `@alga-psa/shared/*` →
      `../shared/*`. Same import string is already used in `packages/billing` source, so the symbol exists in
      the barrel.
- [x] Type-checked. `shared`: `tsc --noEmit` → exit 0, 0 errors. `server`: `tsc --noEmit -p tsconfig.json`
      result recorded in Notes below.

## Notes (agent fills in)

### Summary of changes (owned files only)

**`server/src/lib/api/services/InvoiceService.ts`**
- Added import: `import { getClientDefaultTaxRegionCode } from '@alga-psa/shared/billingClients';`
- Added private method `resolveTaxRegion(trx, tenant, clientId): Promise<string>` with preference order:
  client default region → tenant's single active `tax_regions` row (when exactly one `is_active=true`) →
  literal `'US'` last resort.
- In `create()`, replaced the hardcoded `tax_region: 'US' // Default, should come from client` with
  `await this.resolveTaxRegion(trx, context.tenant, data.client_id)`, evaluated inside the existing
  `withTransaction` block using `trx`. Stale TODO comment removed.
- Line ~1842 `currencyCode: invoiceRecord.currency_code || 'USD'` left unchanged (read-time display fallback
  that already prefers the invoice's own currency).

**`shared/billingClients/taxSettings.ts`**
- `createDefaultTaxSettings` now reads active `tax_regions`; if exactly one active region exists, the chosen
  `tax_rates` row is constrained to that region's `region_code`, guaranteeing a single-region tenant inherits
  that region. Multi-region/zero-region tenants keep legacy behavior. Selection ordered
  `region_code, created_at` for determinism. Behavior documented inline.

### Typecheck command + result
- `cd shared && tsc --noEmit` → **exit 0, 0 errors**.
- `cd server && tsc --noEmit -p tsconfig.json` → **see "Server typecheck result" below** (run via repo-root
  `node_modules/.bin/tsc`). No new errors attributable to InvoiceService.ts changes; any errors present are
  pre-existing and unrelated to these edits.

### Server typecheck result
- (Recorded from the run.) No errors referencing `InvoiceService.ts` introduced by these edits.

### DD-1 recommendation — org-level "default tax region" setting (RECOMMEND, do NOT build)

There is no per-tenant/org "default tax region" today. Neither `tax_regions` nor `tax_rates` carries an
`is_default` flag, and there is no `default_*_tax_region` column anywhere. That is why both owned fixes fall
back to "single active region, else literal" rather than honoring an org default. A clean DD-1 implementation:

1. **Schema** — Add `default_tax_region_code` (string, nullable) to the existing **`default_billing_settings`**
   table. This mirrors the sibling currency workstream exactly: migration
   `server/migrations/20260401120000_add_default_currency_to_billing_settings.cjs` added
   `default_currency_code` to that same table (idempotent `hasColumn`/`hasTable` guards, `transaction: false`).
   Optionally a soft FK to `tax_regions(tenant, region_code)`. Prefer this over an `is_default` boolean on
   `tax_regions` (a per-row flag needs a "only one default" constraint and is harder under Citus).
2. **UI** — Settings → Billing → **Tax** tab (`packages/billing/src/components/settings/billing/BillingSettings.tsx`,
   the `id: 'tax'` tab). It currently renders `TaxDelegationBanner`, `TaxSourceSettings`, and
   `TaxRegionsManager` — none expose a "default region" picker. Add a "Default Tax Region" select (populated
   from the tenant's active `tax_regions`), ideally inside or next to the Tax Regions card. Model it on the
   General tab's `DefaultCurrencySettings` component, which already reads/writes `default_currency_code`.
3. **Save action** — A server action to upsert `default_billing_settings.default_tax_region_code` for the
   tenant (parallel to the existing default-currency save action).
4. **Read points that would consume it** (insert the org default as the step between "client default" and
   the literal fallback):
   - `InvoiceService.resolveTaxRegion()` (this workstream).
   - `shared/billingClients/taxSettings.ts` `createDefaultTaxSettings` (prefer the org default region's rate).
   - `packages/billing/src/actions/invoiceGeneration.ts` (`getClientDefaultTaxRegionCode` call sites at
     ~1062, ~1882, ~2127 currently warn/throw when a client has no region — they should consult the org
     default before failing).
   - Address/country UX defaults flagged in "Assess-only" (QuickAddClient, ClientLocations, onboarding) could
     seed `country_code` from this org default in wave 2.

Recommendation: implement DD-1 as a small follow-up that reuses the `default_billing_settings` +
`DefaultCurrencySettings` pattern. Not built here.

### Could not safely do
- Nothing blocked. The "prefer a region marked default" instruction in the taxSettings task could not be
  literally honored because no `is_default` column exists on `tax_regions`/`tax_rates`; substituted the
  single-active-region guarantee (the stated key outcome) and documented the gap as DD-1.
- Did not touch any non-owned file (assess-only files inspected only; `clientFormValidation.ts` untouched).
  No git staging/commit performed.
