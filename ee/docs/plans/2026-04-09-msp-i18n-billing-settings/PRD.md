# PRD — MSP i18n: Billing & Tax Settings

- Slug: `2026-04-09-msp-i18n-billing-settings`
- Date: `2026-04-09`
- Status: Draft
- Parent plan: `/.ai/translation/MSP_i18n_plan.md`

## Summary

Create a new `msp/billing-settings` i18n namespace and wire `useTranslation` into 17
billing and tax settings components that currently have zero i18n coverage. These
components live under `packages/billing/src/components/settings/billing/`,
`packages/billing/src/components/settings/tax/`, and
`packages/billing/src/components/tax/`. None of them currently import `useTranslation`.

## Problem

MSP users navigating to `/msp/settings?tab=billing` see the surrounding settings chrome
translated (sidebar, tabs) but the billing/tax settings content is hardcoded English.
This includes card titles, field labels, toast messages, validation errors, dialog
titles, confirmation messages, and import wizard copy across 17 components totalling
approximately 6,000 lines of code. Non-English MSP users experience a jarring switch
from translated navigation into an English-only settings surface.

This is a new-namespace project: unlike the tickets migration (which reused an existing
JSON), here we must create `msp/billing-settings.json` from scratch, add it to
`ROUTE_NAMESPACES`, populate translations for 7 languages, and generate pseudo-locales.

## Goals

1. Create `en/msp/billing-settings.json` with all keys needed by the 17 components
2. Wire `useTranslation('msp/billing-settings')` into all 17 components
3. Add `msp/billing-settings` to `ROUTE_NAMESPACES['/msp/settings']`
4. Generate translations for 6 non-English locales (fr, es, de, nl, it, pl)
5. Regenerate pseudo-locales (xx, yy) from updated English source
6. Pass `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
7. Measurable: 0/17 components wired -> 17/17 components wired

## Non-goals

- Translating dynamic data values (currency names, category names, board names) -- those
  are tenant data, not UI chrome
- Translating `handleError()` internal error strings that only appear in console logs
- Moving billing settings components to a different package structure
- Translating the `NumberingSettings` component from `@alga-psa/reference-data` -- that
  belongs to a separate namespace and sub-batch
- Translating the dynamically-imported `PaymentSettingsConfig` (EE-only) -- it has its
  own component boundary and should be handled in an EE i18n pass
- Creating new UI components or changing component architecture

## Users and Primary Flows

**Primary user:** MSP administrators configuring billing and tax settings in non-English
UI languages (any of fr, es, de, nl, it, pl).

**Primary flows affected:**
1. `/msp/settings?tab=billing` -- General tab (currency, invoice numbering, zero-dollar,
   credit expiration, renewal automation)
2. `/msp/settings?tab=billing&section=quoting` -- Quote numbering (when feature-flagged)
3. `/msp/settings?tab=billing&section=tax` -- Tax source selection, tax regions manager
4. `/msp/settings?tab=billing&section=payments` -- Payment settings card
5. Service Catalog and Products management embedded in settings
6. Client-level tax settings form (`TaxSettingsForm`)

## UX / UI Notes

- No visual changes. Text replaced inline via `t('key', { defaultValue: 'English fallback' })`.
- Tab `id` attributes remain ASCII kebab-case (`general`, `quoting`, `tax`, `payments`);
  only `label` values are translated via `t()`.
- Toast messages (`toast.success` / `toast.error`) also translated.
- Confirmation dialog `message` strings with interpolated names use i18next interpolation:
  `t('confirmDelete', { name: categoryName, defaultValue: '...' })`.
- `handleError(error, 'message')` second-arg strings are user-visible and should be translated.
- `throw new Error('...')` and `setError('...')` strings that surface to the user via
  inline error display are translated; those that only appear in `console.error` stay English.
- Form validation strings set via `setValidationErrors([])` or `setError()` are translated.
- Zod schema `.message()` strings in `TaxRegionsManager`, `TaxThresholdEditor`,
  `TaxComponentEditor`, and `TaxHolidayManager` are NOT translated (they are developer-
  facing validation constraints); only the rendered error paragraph text is translated.
- Loading state strings (`"Loading settings..."`, `"Loading boards..."`, etc.) are translated.
- Select option labels (`{ value: 'normal', label: 'Create as Draft' }`) are translated.

## Requirements

### File Inventory

| # | Component | LOC | Est. Strings | Key Content |
|---|-----------|-----|-------------|-------------|
| 1 | BillingSettings.tsx | 264 | ~25 | Tab labels (General/Quoting/Tax/Payments), card titles (Default Currency, Invoice Numbering, Zero-Dollar Invoices, Credit Expiration, Renewal Automation, Quote Numbering, Tax Regions, Payment Settings), card descriptions, loading text |
| 2 | DefaultCurrencySettings.tsx | 62 | ~5 | Currency label, placeholder, toast success, error messages |
| 3 | ZeroDollarInvoiceSettings.tsx | 108 | ~10 | Handling option labels (Create as Draft / Create and Finalize), Suppress toggle label, help text, toast, error |
| 4 | CreditExpirationSettings.tsx | 153 | ~12 | Enable toggle label, expiration period label, notification days label, placeholder, help texts, save button, toast, error |
| 5 | RenewalAutomationSettings.tsx | 259 | ~18 | Policy option labels, board/status select labels, placeholders (Loading boards.../Select board/etc.), help text, save/saving button, toast, error |
| 6 | ServiceCategoriesSettings.tsx | 555 | ~35 | Page heading, table column titles (Name/Description/Order/Actions), action menu items (Edit/Delete), Add/Import buttons, add/edit dialog (title, field labels, placeholders, help text, validation), import dialog (title, empty state, select-all, column headers, conflict resolution radio labels), confirmation dialog, toast messages |
| 7 | ServiceTypeSettings.tsx | 730 | ~45 | Card title/description, table columns (Name/Billing Method/Description/Order/Actions), loading state, billing method labels (Fixed/Hourly/Usage), Add button, add/edit dialog (title, field labels, validation prompt, placeholders, help text), delete confirmation, import dialog (title, empty state, column headers, conflict resolution), toast messages |
| 8 | ServiceCatalogManager.tsx | 996 | ~50 | Page heading, table columns (Service Name/Service Type/Billing Method/Pricing/Unit/Tax Rate/Actions), filter placeholders, loading state, edit dialog (title, field labels, pricing section header, billing method rates, unit of measure label/help, tax rate label, SKU/Inventory/Seat Limit/License Term labels), save/cancel buttons, delete entity dialog labels, toast messages |
| 9 | ProductsManager.tsx | 544 | ~35 | Page heading, table columns (Product/SKU/Type/Category/Label/Pricing/Tax Rate/Active/Actions), action menu (Edit/Restore/Archive/Delete), filter options (All Statuses/Active/Inactive, All Categories, All Types), search placeholder, loading state, add button, archive confirmation, permanent delete dialog (checking/confirm/cannot-delete messages), toast messages |
| 10 | QuickAddService.tsx | 661 | ~40 | Dialog title, field labels (Service Name/Service Type/Billing Method/Description/Pricing/Unit of Measure/Tax Rate/SKU/Inventory Count/Seat Limit/License Term), pricing section (rate type labels, + Add Currency, Remove), validation errors, cancel/save buttons, toast |
| 11 | QuickAddProduct.tsx | 603 | ~40 | Dialog title (Add/Edit Product), field labels (Product Name/Type/SKU/Category/Label/Vendor/Manufacturer/Cost/Billing Method/Pricing/Tax Rate/Active/Unit of Measure/License?/License Term/Description), pricing section, validation errors, cancel/create/save buttons |
| 12 | TaxSourceSettings.tsx | 182 | ~20 | Card title, tooltip, description, radio labels (Internal/External) with descriptions, external workflow steps (numbered list), cancel/save buttons, saving state, toast |
| 13 | TaxRegionsManager.tsx | 356 | ~20 | Card title, Add button, table columns (Code/Name/Status/Actions), status badges (Active/Inactive), action menu (Edit/Activate/Deactivate), dialog title (Add/Edit), field labels (Region Code/Region Name/Active), cancel/save buttons, saving state, toast messages, loading state |
| 14 | TaxThresholdEditor.tsx | 567 | ~35 | Section heading, tooltip, Add Bracket button, table columns (Min Amount/Max Amount/Rate/Actions), action menu (Edit/Delete), bracket issues alert, loading/empty states, calculation preview labels, add/edit dialog (title, field labels, placeholders), delete dialog (confirmation message, last-bracket warning), cancel/save/delete buttons, toast messages |
| 15 | TaxComponentEditor.tsx | 541 | ~30 | Section heading, tooltip, Add Component button, table columns (Seq/Name/Rate/Compound/Date Range/Actions), badges (Yes/No), date range labels (Always/Any/Ongoing), loading/empty states, calculation preview, add/edit dialog (field labels, compound tax toggle description), delete dialog, toast messages |
| 16 | TaxHolidayManager.tsx | 470 | ~25 | Section heading, tooltip, Add Holiday button, table columns (Start Date/End Date/Description/Status/Actions), status badges (Active/Upcoming/Expired), status summary, loading/empty states, add/edit dialog (field labels, placeholder), delete dialog, toast messages |
| 17 | TaxSettingsForm.tsx | 521 | ~35 | Page title (Client Tax Settings), tax exempt card (title/description, toggle labels, certificate field, exempt alert), advanced tax options card (title/description, reverse charge toggle/tooltip, tax source override label/tooltip/options/description, override-not-available alert with link), reset/update buttons, loading state, error/success messages, no-settings-found state |

**Total: ~480 estimated translatable strings**

### Namespace Structure (`msp/billing-settings.json`)

Top-level key groups:

```
tabs.*                    — Tab labels (general, quoting, tax, payments)
general.*                 — General tab card titles and descriptions
  general.currency.*      — Default currency card
  general.invoiceNumbering.* — Invoice numbering card
  general.zeroDollar.*    — Zero-dollar invoice settings
  general.creditExpiration.* — Credit expiration settings
  general.renewal.*       — Renewal automation settings
quoting.*                 — Quoting tab
tax.*                     — Tax tab
  tax.source.*            — Tax calculation source settings
  tax.regions.*           — Tax regions manager
  tax.thresholds.*        — Tax threshold/bracket editor
  tax.components.*        — Tax component editor
  tax.holidays.*          — Tax holiday manager
payments.*                — Payments tab
serviceCategories.*       — Service categories settings
serviceTypes.*            — Service type settings
serviceCatalog.*          — Service catalog manager
products.*                — Products manager
quickAddService.*         — Quick add service dialog
quickAddProduct.*         — Quick add product dialog
clientTaxSettings.*       — Client-level tax settings form
common.*                  — Shared strings (Edit, Delete, Cancel, Save, etc.)
import.*                  — Shared import dialog strings
validation.*              — Shared validation messages
errors.*                  — Shared error messages
toast.*                   — Shared toast messages
```

### Naming Conventions

- camelCase keys, nested under semantic groups
- Follow existing patterns from `features/tickets.json` and `msp/settings.json`
- Reuse keys from `common.json` where they already exist (e.g., `common:actions.save`)
  -- but do NOT add cross-namespace `t()` calls; duplicate into `msp/billing-settings`
  for namespace isolation
- Interpolation uses `{{variable}}` syntax: `t('confirmDelete', { name: categoryName })`

## Data / API / Integrations

- No database changes
- No API changes
- No new npm dependencies
- Reuses existing `useTranslation` hook from `@alga-psa/ui/lib/i18n/client`
- Reuses existing i18next infrastructure loaded via `I18nWrapper` (already in MSP layout)

## Security / Permissions

No change. Translation is a pure presentation-layer concern.

## Observability

N/A -- no new operational concerns.

## Rollout / Migration

- **ROUTE_NAMESPACES update:** Add `'msp/billing-settings'` to the `/msp/settings` entry
  in `packages/core/src/lib/i18n/config.ts`
- **Per-component rollout:** Can ship in 3-4 PRs grouped by sub-batch to keep review
  scope manageable
- **Deploy path:** translations are static JSON served from `server/public/locales/`;
  no cache invalidation beyond standard Next.js static-asset rebuild
- **Back-out:** each PR is independently revertable; components continue rendering English
  via `defaultValue` fallbacks even if JSON keys are reverted

## Open Questions

1. Should `TaxSettingsForm.tsx` (client-level tax settings) use `msp/billing-settings`
   or get its own `msp/client-tax.json`? **Tentative answer:** keep in
   `msp/billing-settings` since it is accessed through the billing settings surface and
   shares significant vocabulary (tax source, reverse charge, exempt status). Revisit if
   the namespace grows past ~500 keys.
2. For `handleError(error, 'Failed to load settings')` -- translate the fallback string?
   **Answer:** Yes, use `t('errors.failedToLoadSettings', { defaultValue: '...' })` since
   `handleError` displays the string to the user via toast.
3. For select option arrays defined as constants (e.g., `POLICY_OPTIONS`, `LICENSE_TERM_OPTIONS`,
   `BILLING_METHOD_OPTIONS`) -- translate at render time or at definition time?
   **Answer:** Translate at render time inside the component using `useMemo` with `t()`,
   so the options react to locale changes. Move the `const` inside the component or wrap
   with a `useMemo` that depends on `t`.

## Acceptance Criteria (Definition of Done)

- [ ] All 17 components import `useTranslation('msp/billing-settings')` and wrap all
      user-visible strings with `t('key', { defaultValue: 'English fallback' })`
- [ ] `en/msp/billing-settings.json` exists with all referenced keys
- [ ] `ROUTE_NAMESPACES['/msp/settings']` includes `'msp/billing-settings'`
- [ ] Translations exist for all 7 real locales (en, fr, es, de, nl, it, pl)
- [ ] `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
      exits 0 (covers key parity across 9 locales, pseudo-locale fill patterns, Italian
      accent preservation, and `{{variable}}` interpolation preservation)
- [ ] Tab labels use `t()` with `id` remaining ASCII kebab-case
- [ ] Visual smoke test: `/msp/settings?tab=billing` renders correctly in `en` and at
      least one non-English locale (de or fr recommended); `xx` pseudo-locale shows
      pseudo-text for every visible string (no bare English leakage)
- [ ] No regressions in existing billing/settings tests
