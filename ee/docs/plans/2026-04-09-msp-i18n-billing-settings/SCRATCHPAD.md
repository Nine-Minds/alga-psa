# SCRATCHPAD — MSP i18n: Billing & Tax Settings

## Key Decisions

### New namespace, not reusing existing
Unlike the tickets migration (which wired into existing `features/tickets.json`), this
batch creates `msp/billing-settings.json` from scratch. The billing settings surface has
no client-portal counterpart, so there is no shared namespace to reuse.

### TaxSettingsForm included in this batch
`TaxSettingsForm.tsx` lives at `packages/billing/src/components/tax/` (outside the
`settings/` directory) but is functionally part of the billing/tax settings surface.
Including it here avoids a standalone sub-batch for a single component. If the namespace
exceeds ~500 keys, consider splitting `clientTaxSettings.*` into a separate namespace.

### Select option translation strategy
Constants like `POLICY_OPTIONS`, `LICENSE_TERM_OPTIONS`, `BILLING_METHOD_OPTIONS` are
currently defined outside components. To support locale-reactive labels, wrap them in
`useMemo` inside the component with `t()` calls, or move the constant inside the
component body. Do NOT try to call `t()` at module scope -- it will not have access to
the i18n context.

### F001 English namespace shape
`server/public/locales/en/msp/billing-settings.json` now exists and intentionally mixes
component-specific groups (`serviceCatalog.*`, `clientTaxSettings.*`, `tax.thresholds.*`)
with a small shared `common.*` / `import.*` layer. The file is broad rather than minimal:
it includes strings for all 17 target components up front so later wiring PRs can mostly
reuse existing keys instead of constantly expanding the namespace.

### Zod schema messages stay English
Zod validation `.message()` strings in `TaxRegionsManager`, `TaxThresholdEditor`,
`TaxComponentEditor`, and `TaxHolidayManager` are NOT translated. They are developer-
facing validation constraints. The rendered `<p>` error messages that display these to
users already get their text from `form.formState.errors.fieldName?.message` -- if we
want to translate those, we would need `t()` in the `<p>` tag wrapping the Zod message,
or switch to custom validation. For now, leave Zod messages as English and translate
only the surrounding UI chrome. This matches the pattern used elsewhere in the codebase.

### handleError second-argument strings
`handleError(error, 'Failed to load settings')` displays the second argument as a toast
fallback. These ARE user-visible and should be translated:
`handleError(error, t('errors.failedToLoadSettings', { defaultValue: 'Failed to load settings' }))`.

### PaymentSettingsConfig excluded
The `PaymentSettingsConfig` component is dynamically imported via `@product/billing/entry`
and resolves to either EE or OSS version at build time. It is outside this batch's scope
and should be handled in an EE-specific i18n pass.

### NumberingSettings excluded
`NumberingSettings` from `@alga-psa/reference-data/components` is rendered inside
`BillingSettings.tsx` but belongs to the `reference-data` package. Its strings should be
translated in a separate sub-batch covering the `reference-data` package namespace.

## Gotchas

1. **ServiceCatalogManager is 996 lines** -- the edit dialog alone has ~30 field labels.
   Break the wiring into two features (F040 table chrome + F041 edit dialog) to keep
   PRs reviewable.

2. **Duplicate BILLING_METHOD_OPTIONS** -- defined separately in `ServiceCatalogManager`,
   `QuickAddService`, and `QuickAddProduct`. The i18n keys should be consistent across
   all three. Use the same keys from the namespace (e.g., `common.billingMethod.fixed`,
   `common.billingMethod.hourly`, `common.billingMethod.usage`).

3. **Dynamic placeholders in RenewalAutomationSettings** -- placeholder text changes
   based on loading state (`'Loading boards...'` vs `'Select board'` vs
   `'Select a board first'`). Each variant needs its own key.

4. **Interpolated confirmation messages** -- Several components use template literals
   in confirmation dialogs: `` `Are you sure you want to delete "${name}"?` ``.
   Convert to `t('confirmDelete', { name, defaultValue: '...' })`.

5. **ProductsManager archive vs delete** -- Two separate confirmation flows with
   different messages. The permanent delete dialog has three states (checking, can-delete,
   cannot-delete) each needing separate translated strings.

6. **TaxThresholdEditor bracket issue messages** -- These are dynamically constructed
   strings with currency formatting. Use interpolation:
   `t('tax.thresholds.issueGap', { from: formatted1, to: formatted2 })`.

7. **TaxHolidayManager heading interpolation** -- The heading conditionally includes
   the tax rate name: `Tax Holidays for ${taxRateName}`. Use:
   `t('tax.holidays.titleWithName', { name: taxRateName })` and
   `t('tax.holidays.title')` for the without-name case.

8. **TaxSettingsForm has inline components (ErrorMessage, SuccessMessage)** -- These
   are defined inside the component function. The `t()` hook is accessible in the parent
   scope and can be used inside these inline components without issues.

9. **English source already carries some cleanup opportunities** -- current components use
   inconsistent variants like `Loading…` vs `Loading...`, `Usage` vs `Usage Based`, and
   `-` vs `—`. Keep the namespace expressive enough to cover the current UI first; defer
   normalization until the component wiring passes so behavior stays reviewable.

## Estimated String Counts by Group

| Group | Est. Keys |
|-------|-----------|
| tabs | 4 |
| general (currency, invoiceNumbering, zeroDollar, creditExpiration, renewal) | 55 |
| quoting | 5 |
| tax (source, regions, thresholds, components, holidays) | 130 |
| payments | 5 |
| serviceCategories | 35 |
| serviceTypes | 45 |
| serviceCatalog | 50 |
| products | 35 |
| quickAddService | 40 |
| quickAddProduct | 40 |
| clientTaxSettings | 35 |
| common (shared Edit/Delete/Cancel/Save/Actions/etc.) | 15 |
| import (shared import dialog strings) | 15 |
| validation/errors/toast (shared patterns) | 20 |
| **Total** | **~530** |

## PR Grouping Suggestion

- **PR 1:** F001 (namespace JSON) + F002 (ROUTE_NAMESPACES) + F010-F014 (BillingSettings + small General-tab components) -- ~5 files, ~75 keys
- **PR 2:** F020-F021 + F030-F031 (ServiceCategoriesSettings + ServiceTypeSettings) -- ~2 files, ~80 keys  
- **PR 3:** F040-F041 + F050-F051 + F060-F062 (ServiceCatalog + Products + QuickAdd dialogs) -- ~4 files, ~165 keys
- **PR 4:** F070-F085 + F090-F092 (All tax components + TaxSettingsForm) -- ~6 files, ~210 keys
- **PR 5:** F100-F107 (Translations for 6 languages + pseudo-locales + validation) -- namespace only, no component changes

## Work Log

### 2026-04-10
- Completed `F001` by adding [billing-settings.json](/Users/natalliabukhtsik/Desktop/projects/bigmac/server/public/locales/en/msp/billing-settings.json).
- The English source includes the planned top-level groups: `tabs`, `general`, `quoting`,
  `tax`, `payments`, `serviceCategories`, `serviceTypes`, `serviceCatalog`, `products`,
  `quickAddService`, `quickAddProduct`, `clientTaxSettings`, `common`, `import`,
  `validation`, `errors`, and `toast`.
- Source inventories came from direct component reads plus parallel component-specific
  inventories for general billing, service categories/types, service catalog/products,
  and tax/client-tax surfaces.
- Validation run:
  `node -e "JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/billing-settings.json','utf8')); console.log('ok')"`
- Completed `F002` by adding `'msp/billing-settings'` to the `/msp/settings` entry in
  [config.ts](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/core/src/lib/i18n/config.ts).
- Verification run:
  `rg -n "'/msp/settings'|msp/billing-settings" packages/core/src/lib/i18n/config.ts`
- Completed `F003` in
  [BillingSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/BillingSettings.tsx).
- `BillingSettings.tsx` now imports `useTranslation('msp/billing-settings')`, translates the
  four tab labels, all section card titles/descriptions, and the payment skeleton loading
  text. Tab `id` values remain `general`, `quoting`, `tax`, and `payments`.
- Verification runs:
  `rg -n "General'|Quoting'|Tax'|Payments'|Default Currency|Invoice Numbering|Zero-Dollar Invoices|Credit Expiration|Renewal Automation|Quote Numbering|Tax Regions|Payment Settings|Loading payment settings" packages/billing/src/components/settings/billing/BillingSettings.tsx`
- Completed `F004` in
  [DefaultCurrencySettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/DefaultCurrencySettings.tsx).
- Wired the select label, placeholder, success toast, and `handleError` fallback strings to
  `general.currency.*`.
- Verification runs:
  `sed -n '1,200p' packages/billing/src/components/settings/billing/DefaultCurrencySettings.tsx`
- Completed `F005` in
  [ZeroDollarInvoiceSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ZeroDollarInvoiceSettings.tsx).
- Wired the handling options, select label/placeholder, suppress toggle copy, success toast,
  and save/load fallback errors to `general.zeroDollar.*`.
- Verification runs:
  `sed -n '1,220p' packages/billing/src/components/settings/billing/ZeroDollarInvoiceSettings.tsx`
- Completed `F006` in
  [CreditExpirationSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/CreditExpirationSettings.tsx).
- Wired the enable toggle, expiration/notification field copy, save button, success toast,
  and save/load fallback errors to `general.creditExpiration.*`.
- Verification runs:
  `sed -n '1,240p' packages/billing/src/components/settings/billing/CreditExpirationSettings.tsx`
- Completed `F007` in
  [RenewalAutomationSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/RenewalAutomationSettings.tsx).
- Moved the due-date action policy options into `React.useMemo(..., [t])` inside the
  component so the option labels translate at render time and react to locale changes.
- Wired the due-date action label/help, board and status labels, all loading/select
  placeholders, board fallback label, save/saving button, success toast, and error
  fallbacks to `general.renewal.*`.
- Verification runs:
  `sed -n '1,280p' packages/billing/src/components/settings/billing/RenewalAutomationSettings.tsx`
- Completed `F008` in
  [ServiceCategoriesSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ServiceCategoriesSettings.tsx).
- Scoped this pass to the outer chrome only: page heading, table column titles, row action
  menu labels, and Add/Import buttons. Dialog bodies, validation, toasts, and import-flow
  copy are intentionally left for `F009`.
- Verification runs:
  `sed -n '1,260p' packages/billing/src/components/settings/billing/ServiceCategoriesSettings.tsx`
- Completed `F009` in
  [ServiceCategoriesSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ServiceCategoriesSettings.tsx).
- Wired the delete confirmation dialog, add/edit dialog copy, validation/error messages,
  create/update/delete/import toasts, import dialog copy, and conflict-resolution strings
  to `serviceCategories.*`, `common.*`, and `import.*`.
- Verification runs:
  `sed -n '60,560p' packages/billing/src/components/settings/billing/ServiceCategoriesSettings.tsx`
- Completed `F010` in
  [ServiceTypeSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ServiceTypeSettings.tsx).
- Scoped this pass to the loading state, card title/description, table column headers,
  billing method display labels, row action menu labels, and Add/Import buttons.
  Dialog, validation, delete-confirmation, and import-conflict strings are left for `F011`.
- Verification runs:
  `sed -n '286,322p' packages/billing/src/components/settings/billing/ServiceTypeSettings.tsx`
- Completed `F011` in
  [ServiceTypeSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ServiceTypeSettings.tsx).
- Wired the add/edit dialog copy, required-field summary, delete confirmation with in-use
  error state, import dialog copy, conflict-resolution strings, and import/save/delete
  fallback messaging to `serviceTypes.*`, `common.*`, and `import.*`.
- Verification runs:
  `sed -n '1,760p' packages/billing/src/components/settings/billing/ServiceTypeSettings.tsx`
- Completed `F012` in
  [ServiceCatalogManager.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx).
- Scoped this pass to the outer service catalog surface: page heading, filter labels and
  placeholders, loading text, table column titles, non-taxable label, and row action menu
  labels. The edit dialog remains intentionally deferred to `F013`.
- Verification runs:
  `sed -n '1,700p' packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx`
- Completed `F013` in
  [ServiceCatalogManager.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx).
- Wired the edit dialog title, all dialog field labels/placeholders, pricing section copy,
  tax-rate loading/select placeholders, conditional hardware/license fields, save/cancel
  buttons, and update/delete fallback errors to `serviceCatalog.*` and `common.*`.
- Moved billing-method and license-term option labels into `useMemo(..., [t])` inside the
  component so the select options react to locale changes instead of staying stuck at the
  module-scope English labels.
- Also translated adjacent service-catalog strings still visible in the same surface:
  the delete-dialog fallback entity name, `N/A` table fallbacks, and the row-action
  `Open menu` accessibility label.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/billing/ServiceCatalogManager.tsx`
  `node -e "const fs=require('fs');const p='server/public/locales/en/msp/billing-settings.json';JSON.parse(fs.readFileSync(p,'utf8'));console.log('ok')"`
- Completed `F014` in
  [ProductsManager.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ProductsManager.tsx).
- Scoped this pass to the outer products-manager chrome: card title, add/search controls,
  filter option labels, loading text, table headers, active/non-taxable display labels,
  and row action menu labels.
- Kept archive and permanent-delete dialog bodies, plus their fallback error strings,
  deferred to `F015` so the confirmation flows land in a separate commit.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/billing/ProductsManager.tsx`
- Completed `F015` in
  [ProductsManager.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/ProductsManager.tsx).
- Wired the archive confirmation copy, permanent-delete checking/confirm/blocked states,
  cancel/delete labels, fallback `"this product"` interpolation value, and all user-facing
  products-manager error fallbacks to `products.*`.
- Expanded the English namespace with `products.thisProduct` so both confirmation flows can
  interpolate a translated fallback name instead of hardcoding English in JSX.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/billing/ProductsManager.tsx`
  `node -e "const fs=require('fs');const p='server/public/locales/en/msp/billing-settings.json';JSON.parse(fs.readFileSync(p,'utf8'));console.log('ok')"`
- Completed `F016` in
  [QuickAddService.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/QuickAddService.tsx).
- Scoped this pass to the shared quick-add-service dialog surface: trigger button, dialog
  title, core field labels/placeholders, pricing section strings, tax-rate label, generic
  validation summary/items, and cancel/save actions.
- Moved billing-method option labels into `useMemo(..., [t])` so the select reacts to locale
  changes instead of keeping module-scope English labels.
- Left the unit-of-measure branch, hardware/license fields, tax-rate loading/select
  placeholder, and fallback error strings for `F017`.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/billing/QuickAddService.tsx`
  `rg -n "Unit of Measure \\*|Loading tax rates|Select Tax Rate \\(optional\\)|SKU is required for Hardware|License term is required for Software Licenses|Selected service type not found|Failed to fetch categories|Failed to load tax rates|Failed to create service|SKU|Inventory Count|Seat Limit|License Term" packages/billing/src/components/settings/billing/QuickAddService.tsx`
- Completed `F017` in
  [QuickAddService.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/QuickAddService.tsx).
- Wired the usage-only unit-of-measure copy, tax-rate loading/select placeholders,
  hardware/license field labels and placeholders, hardware/license validation fallbacks,
  service-type-not-found fallback, and fetch/create error fallbacks to `quickAddService.*`.
- Moved license-term option labels into `useMemo(..., [t])` so both billing-method and
  license-term selects now react to locale changes in the dialog.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/billing/QuickAddService.tsx`
- Completed `F018` in
  [QuickAddProduct.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/billing/QuickAddProduct.tsx).
- Wired the add/edit dialog title, every field label/placeholder, pricing editor copy,
  active/license option labels, validation errors, and cancel/create/save actions to
  `quickAddProduct.*` and shared `common.*` keys.
- Expanded the English namespace by replacing the generic `quickAddProduct.errors.save`
  interpolation key with explicit `errors.create` and `errors.update` keys so the dialog
  does not have to interpolate English verbs at runtime.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/billing/QuickAddProduct.tsx`
  `node -e "const fs=require('fs');const p='server/public/locales/en/msp/billing-settings.json';JSON.parse(fs.readFileSync(p,'utf8'));console.log('ok')"`
- Completed `F019` in
  [TaxSourceSettings.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxSourceSettings.tsx).
- Wired the card title/tooltip/description, internal vs external radio copy, external-tax
  workflow alert, loading/saving states, save success toast, and load/save fallback errors
  to `tax.source.*`.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxSourceSettings.tsx`
- Completed `F020` in
  [TaxRegionsManager.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxRegionsManager.tsx).
- Wired the tax-regions card title, loading state, add button, table headers/status badges,
  row action menu labels, add/edit dialog copy, active toggle label, save/cancel actions,
  create/update/toggle toasts, and fallback errors to `tax.regions.*` plus shared
  `common.*` status/column/a11y keys.
- Replaced the original generic activate/deactivate interpolation keys with explicit
  `activatePending`, `deactivatePending`, `activated`, `deactivated`, `errors.activate`,
  and `errors.deactivate` keys in the English namespace so later locale translations do
  not have to reconstruct English verb inflections.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxRegionsManager.tsx`
  `node -e "const fs=require('fs');const p='server/public/locales/en/msp/billing-settings.json';JSON.parse(fs.readFileSync(p,'utf8'));console.log('ok')"`
- Completed `F021` in
  [TaxThresholdEditor.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxThresholdEditor.tsx).
- Scoped this pass to the outer thresholds editor surface: section heading/tooltip, add
  button, table headers and action labels, no-limit/above labels, bracket-issue messages,
  loading/empty states, and the calculation-preview labels and interpolated totals.
- Added explicit `tax.thresholds.table.minAmount` and `tax.thresholds.table.maxAmount`
  keys to the English namespace instead of deriving those headers by string-mangling the
  form-field labels, which would have broken later locale translations.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxThresholdEditor.tsx`
  `node -e "const fs=require('fs');const p='server/public/locales/en/msp/billing-settings.json';JSON.parse(fs.readFileSync(p,'utf8'));console.log('ok')"`
- Completed `F022` in
  [TaxThresholdEditor.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxThresholdEditor.tsx).
- Wired the add/edit dialog titles, field labels/placeholders, save/cancel states,
  create/update/delete toasts, delete fallback error, delete-confirmation message with
  bracket-range interpolation, and the last-bracket warning to `tax.thresholds.*`.
- Kept the delete-range interpolation locale-safe by reusing the translated
  `tax.thresholds.noLimit` token directly instead of lowercasing it in code.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxThresholdEditor.tsx`
- Completed `F023` in
  [TaxComponentEditor.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxComponentEditor.tsx).
- Scoped this pass to the outer tax-components surface: section heading/tooltip, add
  button, table headers, yes/no compound badges, date-range display labels, loading/empty
  states, calculation-preview labels, and row action labels.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxComponentEditor.tsx`
- Completed `F024` in
  [TaxComponentEditor.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxComponentEditor.tsx).
- Wired the add/edit dialog titles, field labels/placeholders, compound-tax help text,
  start/end date labels, save/cancel/delete states, create/update/delete toasts, fallback
  errors, and delete-confirmation copy with component-name interpolation.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxComponentEditor.tsx`
- Completed `F025` in
  [TaxHolidayManager.tsx](/Users/natalliabukhtsik/Desktop/projects/bigmac/packages/billing/src/components/settings/tax/TaxHolidayManager.tsx).
- Scoped this pass to the outer holidays surface: title/title-with-name interpolation,
  tooltip, add button, table headers, active/upcoming/expired badges, status summary
  labels, loading/empty states, and row action labels.
- Verification runs:
  `./node_modules/.bin/eslint packages/billing/src/components/settings/tax/TaxHolidayManager.tsx`
