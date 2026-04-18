# Scratchpad — MSP i18n: Service Catalog & Tax Rate Management

- Plan slug: `2026-04-09-msp-i18n-service-catalog`
- Created: `2026-04-09`
- Last synced to codebase: `2026-04-17`

## Status Recheck (2026-04-17)

**Still 0% implemented.** Verified against the current codebase:

- `server/public/locales/en/msp/service-catalog.json` — **does not exist**.
- All 14 components listed in the PRD still have `useTranslation=0`.
- `features.json` / `tests.json`: 0/20 features, 0/16 tests marked implemented.
- `BucketServiceConfigPanel.tsx` still imports the legacy `BILLING_FREQUENCY_OPTIONS` constant (not `useBillingFrequencyOptions`) — the 2026-04-14 migration hasn't happened yet. Still listed in Acceptance Criteria as required.

### Billing-settings plan (shipped) — overlap check

The parallel `2026-04-09-msp-i18n-billing-settings` batch merged (all 37 features implemented). Its scope was the 17 *settings* components under `server/src/components/settings/billing-settings/` and `settings/tax/` (e.g., `ServiceCatalogManager`, `ServiceCategoriesSettings`, `ServiceTypeSettings`, `ProductsManager`, `TaxRegionsManager`, `TaxSettingsForm`, `TaxHolidayManager`, `TaxComponentEditor`, `TaxThresholdEditor`, `QuickAddService`, `QuickAddProduct`, `RenewalAutomationSettings`, `CreditExpirationSettings`, `ZeroDollarInvoiceSettings`, `DefaultCurrencySettings`).

**Result: no file-level overlap.** This batch's 14 files live under `packages/billing/src/components/billing-dashboard/` (TaxRates, TaxRateDetailPanel, ServiceForm, and the service-config/service-configurations panels). Different files, different namespace. `ServiceCatalogManager.tsx` (settings) ≠ `ServiceForm.tsx` (dashboard). `TaxRegionsManager.tsx` (settings) ≠ `TaxRates.tsx` (dashboard).

**Terminology-sync needs:** the `msp/billing-settings` namespace already defines translated terms like "Tax Rate", "Service Category", "Service Type", "Billing Period", "Overage", etc. When extracting keys for `msp/service-catalog`, copy the English phrasing verbatim from `msp/billing-settings.json` so the translations AI produces consistent output across the two namespaces. Spot-check: "Tax Rate" must not become "Aliquota fiscale" in one file and "Imposta" in another.

### Enum-labels pattern now fully landed (2026-04-14 → 2026-04-16)

The enum-labels pattern (`.ai/translation/enum-labels-pattern.md`) is adopted. Published hooks in `@alga-psa/billing/hooks/useBillingEnumOptions.ts`:

- `useBillingFrequencyOptions()` / `useFormatBillingFrequency()` → `features/billing.json#enums.billingFrequency.*`
- `useContractLineTypeOptions()` / `useFormatContractLineType()` → `features/billing.json#enums.contractLineType.*`
- **(new since initial PRD — 2026-04-16, `8528a0816 enums translated` / PR #2344)** Further enum hooks added for related billing enums. Re-check `useBillingEnumOptions.ts` exports before touching any of the 14 files — if a plan-type / contract-line-preset hook exists, use it instead of translating in-place.

**Plan updates:**
- `BucketServiceConfigPanel.tsx` migration: use `useBillingFrequencyOptions()` (already in PRD "In scope" section). Keep.
- **New:** audit `UsageServiceConfigPanel.tsx` and `HourlyServiceConfigPanel.tsx` for any billing-frequency / plan-type selects introduced after 2026-04-09. If found, wire via the published hooks instead of local `t()`.
- Component-local constants (`CONFIGURATION_TYPE_OPTIONS`, `userTypeOptions`, billing-method options in `ServiceForm`, `alignmentOptions`) remain component-local and stay inside their component bodies with inline `t()` calls. Unchanged.

### Recent code changes to in-scope files

`git log --since="2026-04-09" -- <14 files>` returns only `7da29f66c add footer for most of them`. File touches are minor footer additions — no new string groups, no path changes, no LOC blowout. PRD file inventory remains accurate.

### Route namespace reminder

PRD updates `/msp/settings`. If `BucketServiceConfigPanel` uses `useTranslation('features/billing')` for its frequency options (via the shared hook), the `/msp/settings` route must ALSO load `features/billing`. Today `/msp/settings` loads: `['common', 'msp/core', 'msp/settings', 'msp/admin', 'msp/email-providers', 'features/projects', 'features/tickets']` — **missing `features/billing`**. Add it alongside `msp/service-catalog`:

```typescript
'/msp/settings': ['common', 'msp/core', 'msp/settings', 'msp/admin', 'msp/email-providers', 'features/projects', 'features/tickets', 'msp/service-catalog', 'features/billing'],
```

This wasn't explicit in the PRD Acceptance Criteria (line 119 says "If BucketServiceConfigPanel renders under a route that does not already load features/billing, that route entry has been updated") — treat it as a firm requirement now.

### No structural plan overhaul

Proceed with the 20 features / 16 tests already in `features.json` / `tests.json`, plus:

- Re-audit for any newly-added billing-frequency / plan-type selects on the 14 components (none found today, but enum-labels guidance applies if any appear).
- Treat the `features/billing` addition to `/msp/settings` as mandatory, not conditional.

---

## Decisions

- (2026-04-09) **Single namespace**: All 14 files go into `msp/service-catalog` rather than splitting tax rates and service config into separate namespaces. The files are tightly coupled (service form references tax rates, config panels are composed together) and the total string count (~285-430) fits comfortably in one namespace.
- (2026-04-09) **Route mapping**: Service catalog components are rendered under `/msp/settings`, so `msp/service-catalog` is appended to the existing `/msp/settings` ROUTE_NAMESPACES entry rather than creating a new route.
- (2026-04-09) **Execution order**: Tax rates (TaxRates + TaxRateDetailPanel) first since they're self-contained, then ServiceForm, then the service-config panels (largest group), then the service-configurations orchestrator panels last.
- (2026-04-14) **Shared enum-labels pattern applies to one file in this batch — `BucketServiceConfigPanel.tsx`.** The contract-lines batch adopted a localized option-hook pattern for shared billing enums (`BILLING_FREQUENCY_*`, `CONTRACT_LINE_TYPE_*`, `PLAN_TYPE_*`) and published `useBillingFrequencyOptions` / `useFormatBillingFrequency` / `useContractLineTypeOptions` / `useFormatContractLineType` from `@alga-psa/billing/hooks/useBillingEnumOptions`. Translation keys live in `features/billing.json` under `enums.billingFrequency.*` and `enums.contractLineType.*`. See `.ai/translation/enum-labels-pattern.md`. **Migration for this batch:** replace the `BILLING_FREQUENCY_OPTIONS` import in `BucketServiceConfigPanel.tsx:116` with `useBillingFrequencyOptions()`. Do NOT use this shared hook for the other local enum constants in this batch (`CONFIGURATION_TYPE_OPTIONS`, `userTypeOptions`, billing-method options, `alignmentOptions`) — those are component-local and should be translated in-place with `t()` after moving the arrays inside the component body (as originally planned).
- (2026-04-14) **Namespace loading for `BucketServiceConfigPanel`:** the hook calls `useTranslation('features/billing')`. The `features/billing` namespace is currently loaded for `/msp/billing` and `/client-portal/billing`. `BucketServiceConfigPanel` lives in `service-configurations/` and is rendered under `/msp/settings` (service catalog). Verify whether `/msp/settings` needs `features/billing` added to its `ROUTE_NAMESPACES` entry — if yes, append it in the same PR as the import swap.

## Discoveries / Constraints

### Portuguese runtime support gap
- (2026-04-17) The PRD requires `pt` production locales, but the current runtime configs do **not** support Portuguese:
  - `packages/core/src/lib/i18n/config.ts` supported locales: `en, fr, es, de, nl, it, pl, xx, yy`
  - `server/src/middleware/i18nConfig.ts` supported locales: `en, fr, es, de, nl, it, pl`
  - `packages/ui/src/lib/i18n/LanguageSwitcher.tsx` already has a `pt` flag entry, so the missing support is specifically the shared locale config + middleware list.
- **Plan addition required:** add an atomic follow-up feature/test so `pt/msp/service-catalog.json` is not dead weight. Without this, Portuguese translations could exist on disk but never be selectable/resolved by the app.

### Two ServiceConfigurationPanel files
- (2026-04-09) There are two files with the same component name in different directories:
  - `service-configurations/ServiceConfigurationPanel.tsx` (279 LOC) — orchestrator that composes Base + type-specific panels, has save/cancel buttons and bucket overlay logic.
  - `service-config/ServiceConfigurationPanel.tsx` (135 LOC) — service detail page shell that composes ServiceTaxSettings + ServiceRateTiers + UnitOfMeasureInput.
  - Use distinct key prefixes: `serviceConfig.*` for the orchestrator, `serviceDetail.*` for the service-config shell.

### TaxRateDetailPanel sub-components
- (2026-04-09) `TaxRateDetailPanel.tsx` imports `TaxComponentEditor`, `TaxThresholdEditor`, and `TaxHolidayManager` from `../settings/tax/`. Those sub-components are **out of scope** for this batch since they live in the settings/tax directory, not the service catalog area. They likely warrant their own translation pass.

### ConfigurationTypeSelector descriptions
- (2026-04-09) `CONFIGURATION_TYPE_DESCRIPTIONS` and `CONFIGURATION_TYPE_OPTIONS` are module-level constants. After wiring `useTranslation`, these must move inside the component body (or be converted to functions that accept `t`) since `t()` requires the hook context. **(2026-04-14 note):** These are component-local enums, not shared across feature areas — keep the translations inline with `t()` calls. This is distinct from the shared `BILLING_FREQUENCY_*` / `CONTRACT_LINE_TYPE_*` pattern (which uses the published hooks from `packages/billing/src/hooks/useBillingEnumOptions.ts`).

### Currency display
- (2026-04-09) Several components display currency values with hardcoded `$` prefix:
  - `ServiceSelectionDialog.tsx` line 248: `${service.default_rate}`
  - `ServiceRateTiers.tsx` line 269: `Rate (${service.unit_of_measure})`
  - `HourlyServiceConfigPanel.tsx` line 191: `${(item.rate / 100).toFixed(2)}`
  - `ServiceConfigurationPanel (service-config)` line 115: `${service.default_rate} per {service.unit_of_measure}`
  - These should use `useFormatters()` for locale-aware currency formatting where the value is a monetary amount.

### Validation error strings
- (2026-04-09) Multiple components define validation error messages as inline strings in `useEffect` hooks:
  - UsageServiceConfigPanel: "Unit of measure is required", "Minimum usage cannot be negative", tier overlap errors
  - HourlyServiceConfigPanel: "Minimum billable time cannot be negative", "Round up value cannot be negative"
  - BucketServiceConfigPanel: "Total minutes must be greater than zero", "Overage rate cannot be negative"
  - BaseServiceConfigPanel: "Rate cannot be negative", "Quantity cannot be negative"
  - ServiceRateTiers: "Minimum quantity must be greater than 0", "Rate cannot be negative", etc.
  - These validation strings must be extracted into the namespace and the `useEffect` hooks must have access to `t()`.

### User type options
- (2026-04-09) `HourlyServiceConfigPanel.tsx` defines `userTypeOptions` as a module-level constant array with labels like "Technician", "Engineer", "Consultant", "Project Manager", "Administrator". The `value` fields (e.g., `'technician'`, `'engineer'`) must stay untranslated (they are data values), but the `label` fields need translation. This constant must move inside the component.

### Billing method options
- (2026-04-09) `ServiceForm.tsx` has inline billing method options: "Fixed Price", "Hourly", "Usage Based". These should be translated but the `value` fields (`'fixed'`, `'hourly'`, `'usage'`) must remain untranslated.

### Alignment options
- (2026-04-09) `FixedServiceConfigPanel.tsx` has `alignmentOptions` with labels "Start of Billing Cycle", "End of Billing Cycle", "Proportional Coverage". The `value` fields (`'start'`, `'end'`, `'prorated'`) must remain untranslated.

### Shared terminology
- (2026-04-09) Billing/tax terminology should be consistent with existing `msp/settings.json`, `features/billing.json`, and `msp/contracts.json` namespaces. Cross-check terms like "Tax Rate", "Billing Period", "Overage Rate", "Proration" during key creation.

## Gotchas

1. **Module-level constants with UI text**: `CONFIGURATION_TYPE_OPTIONS`, `CONFIGURATION_TYPE_DESCRIPTIONS`, `userTypeOptions`, `alignmentOptions`, and billing method options all need to be moved inside their respective component bodies to access `t()`.
2. **Dynamic string construction**: `TaxRates.tsx` line 153 builds error messages with template literals: `` `Failed to ${isEditing ? 'update' : 'add'} tax rate` ``. This should become two separate translation keys.
3. **Composite tax rate label**: `TaxRates.tsx` line 60 constructs `${regionName} tax rate` for the delete dialog entity name. Extract as an interpolated key: `t('taxRates.deleteEntityName', { regionName })`.
4. **Mismatch warning in BucketServiceConfigPanel**: Line 125 builds a warning with embedded variables: `Bucket billing period (${billingPeriod}) should match contract line billing frequency (${contractLineBillingFrequency})`. Use interpolation: `t('bucketConfig.periodMismatch', { billingPeriod, contractLineBillingFrequency })`.
5. **Plural handling**: `ServiceSelectionDialog.tsx` line 297-299 uses a ternary for pluralization: `service${selectedServices.length !== 1 ? 's' : ''} selected`. Use i18next `_one`/`_other` plural keys or `t('serviceSelection.selectedCount', { count })`.
6. **sr-only text**: `TaxRates.tsx` line 288 has `<span className="sr-only">Open menu</span>`. This accessibility text must be translated.

## 2026-04-17 Working Log

- Repo state before work: unrelated modified plan files already present under `ee/docs/plans/2026-04-09-msp-i18n-credits/`; leave untouched.
- Commands used for initial audit:
  - `git status --short`
  - `jq '.[] | select(.implemented==false)' ee/docs/plans/2026-04-09-msp-i18n-service-catalog/{features,tests}.json`
  - `sed -n '1,260p'` / `sed -n '1,420p'` across the 14 in-scope component files
  - `sed -n '1,260p' packages/core/src/lib/i18n/config.ts`
  - `sed -n '1,220p' server/src/middleware/i18nConfig.ts`
  - `sed -n '1,260p' packages/billing/src/hooks/useBillingEnumOptions.ts`
  - `find . -name 'generate-pseudo-locales.cjs' -o -name 'validate-translations.cjs'`
- Immediate implementation order:
  1. Add missing checklist items for Portuguese runtime support.
  2. Build `server/public/locales/en/msp/service-catalog.json` from all 14 components (`F001`).
  3. Wire components and route/runtime config.
  4. Add/adjust tests, generate locales, validate, and build.
- **(2026-04-17, F001)** Created `server/public/locales/en/msp/service-catalog.json` with 13 top-level groups matching the PRD namespace layout (`taxRates`, `taxRateDetail`, `serviceForm`, `serviceSelection`, `configType`, `serviceConfig`, `fixedConfig`, `hourlyConfig`, `usageConfig`, `bucketConfig`, `rateTiers`, `serviceTaxSettings`, `serviceDetail`). The English source currently contains 258 leaf keys covering all 14 in-scope components, including carried-over enum-adjacent copy and currency/validation/helper text. Validation used:
  - `jq empty server/public/locales/en/msp/service-catalog.json`
  - `jq 'keys' server/public/locales/en/msp/service-catalog.json`
- **(2026-04-17, F002)** Wired `packages/billing/src/components/billing-dashboard/TaxRates.tsx` to `useTranslation('msp/service-catalog')`. Replaced hardcoded English in delete-entity labels, fetch/save/delete validation errors, required-field validation text, DataTable headers, badge/action-menu copy, card title, loading indicator, and tax-rate dialog title/body/labels/buttons with `t(..., { defaultValue })`. Also cleaned local unused imports and stabilized the data-fetch effects with `useCallback` so the file lints cleanly apart from three pre-existing/general warnings (`any` in caught errors, one non-null assertion). Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/TaxRates.tsx packages/billing/src/components/billing-dashboard/TaxRateDetailPanel.tsx`
- **(2026-04-17, F003)** Wired `packages/billing/src/components/billing-dashboard/TaxRateDetailPanel.tsx` to `useTranslation('msp/service-catalog')`. Translated the back action, card subtitle/composite badge, tab labels, detail field labels, active/composite values, tax-precedence ordered list, simple-rate alert copy, and progressive-bracket helper text. Removed stale unused React imports while touching the file. Validation reused:
  - `npx eslint packages/billing/src/components/billing-dashboard/TaxRates.tsx packages/billing/src/components/billing-dashboard/TaxRateDetailPanel.tsx`
- **(2026-04-17, F004)** Wired `packages/billing/src/components/billing-dashboard/ServiceForm.tsx` to `useTranslation('msp/service-catalog')`. Added translated placeholders, explicit translated labels for the service-type / billing-method / tax-rate selects, localized billing-method option arrays inside the component body, and translated fallback/error strings for service-type and tax-data loading. While wiring, the English namespace needed two missing leaf keys: `serviceForm.fields.serviceType.label` and `serviceForm.fields.billingMethod.label`; these were added to `server/public/locales/en/msp/service-catalog.json` immediately so the namespace remains authoritative. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/ServiceForm.tsx`
- **(2026-04-17, F005)** Wired `packages/billing/src/components/billing-dashboard/service-config/ServiceSelectionDialog.tsx` to `useTranslation('msp/service-catalog')` and `useFormatters()`. Translated the dialog title, selection-count footer, cancel/add actions, search placeholder, loading/empty/error states, table headers, product/service badges, unknown-type fallback, quick-add label/button text, and switched the rate column from raw `$` concatenation to locale-aware `formatCurrency(service.default_rate, service.prices?.[0]?.currency_code || 'USD')`. Removed one dead `categories` memo discovered by the lint pass. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-config/ServiceSelectionDialog.tsx`
- **(2026-04-17, F006)** Wired `packages/billing/src/components/billing-dashboard/service-configurations/ConfigurationTypeSelector.tsx` to `useTranslation('msp/service-catalog')`. Moved the local configuration-type option labels/descriptions inside the component body, left the icon map module-scoped, and translated both the card-based selector and dropdown/warning-dialog variants with shared `configType.*` keys. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-configurations/ConfigurationTypeSelector.tsx`
- **(2026-04-17, F007)** Wired the shared service-config panels:
  - `packages/billing/src/components/billing-dashboard/service-configurations/BaseServiceConfigPanel.tsx`
  - `packages/billing/src/components/billing-dashboard/service-configurations/ServiceConfigurationPanel.tsx`
  Added `useTranslation('msp/service-catalog')` for the base section title, service label, effective-mode/default-source labels, translated mode/source values, configuration-type label, quantity/custom-rate field copy, and the orchestrator save/cancel + bucket-overlay recommendation labels. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-configurations/BaseServiceConfigPanel.tsx packages/billing/src/components/billing-dashboard/service-configurations/ServiceConfigurationPanel.tsx`
- **(2026-04-17, F008)** Wired `packages/billing/src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel.tsx` to `useTranslation('msp/service-catalog')`, moved the local alignment options inside the component body, and translated the section title, proration toggle, alignment label/placeholder, option labels, and helper text. Also switched the component to destructure only the props it actually uses so the lint check stays clean. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-configurations/FixedServiceConfigPanel.tsx`
- **(2026-04-17, F009)** Wired `packages/billing/src/components/billing-dashboard/service-configurations/HourlyServiceConfigPanel.tsx` to `useTranslation('msp/service-catalog')`, moved the local `userTypeOptions` array inside the component body, and translated the panel title, minimum/rounding field labels + helper text, validation messages, user-type-rate section title/headers, user-type options, and add-rate controls. Removed an unused `Switch` import uncovered by lint. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-configurations/HourlyServiceConfigPanel.tsx`
- **(2026-04-17, F010)** Wired `packages/billing/src/components/billing-dashboard/service-configurations/UsageServiceConfigPanel.tsx` to `useTranslation('msp/service-catalog')`. Translated the panel title, unit/minimum-usage fields, tiered-pricing toggle, tier builder labels/placeholders, empty/help text, and every tier-validation branch. Added `usageConfig.defaults.unitOfMeasure = "Unit"` to the English namespace and routed the component’s default state through that key so pseudo-locale QA won’t leak a hardcoded English `"Unit"` value into the input and tier labels. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-configurations/UsageServiceConfigPanel.tsx`
- **(2026-04-17, F011)** Wired `packages/billing/src/components/billing-dashboard/service-configurations/BucketServiceConfigPanel.tsx` to `useTranslation('msp/service-catalog')`, replaced the deprecated `BILLING_FREQUENCY_OPTIONS` constant import with `useBillingFrequencyOptions()` / `useFormatBillingFrequency()` from `@alga-psa/billing/hooks/useBillingEnumOptions`, and translated the title, field labels/placeholders, helper text, rollover toggle, mismatch warning, and validation errors. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-configurations/BucketServiceConfigPanel.tsx`
  - `rg -n 'BILLING_FREQUENCY_OPTIONS|BILLING_FREQUENCY_DISPLAY' packages/billing/src/components/billing-dashboard/service-configurations/` → no matches
- **(2026-04-17, F012)** Wired `packages/billing/src/components/billing-dashboard/service-config/ServiceRateTiers.tsx` to `useTranslation('msp/service-catalog')` and `useFormatters()`. Translated the card title, loading/description text, table headers, unlimited placeholder, add/save actions, and all validation errors. Added a localized per-row rate preview (`{{formattedCurrency}} per {{unit}}`) under the numeric input so the screen now shows locale-aware money formatting while keeping the editable numeric field intact. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-config/ServiceRateTiers.tsx`
- **(2026-04-17, F013)** Wired `packages/billing/src/components/billing-dashboard/service-config/ServiceTaxSettings.tsx` to `useTranslation('msp/service-catalog')`. Translated the card title, tax-rate select label/placeholders/help text, the `Non-Taxable` option, the dynamic option label template, and the load/save error states plus save-button copy. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-config/ServiceTaxSettings.tsx`
- **(2026-04-17, F014)** Wired `packages/billing/src/components/billing-dashboard/service-config/ServiceConfigurationPanel.tsx` to `useTranslation('msp/service-catalog')` and `useFormatters()`. Translated the loading/error states, card title/description, section headings, and switched the base-rate summary to localized `formatCurrency(... )` output before interpolating the unit label. Validation:
  - `npx eslint packages/billing/src/components/billing-dashboard/service-config/ServiceConfigurationPanel.tsx`
- **(2026-04-18, F015)** Generated the seven production locale files for `msp/service-catalog` at `server/public/locales/{de,es,fr,it,nl,pl,pt}/msp/service-catalog.json`. The generation pass reused exact wording from the existing `msp/billing-settings`, `features/billing`, and `msp/settings` locale files when the English source text already existed there, then machine-translated only the remaining namespace-specific strings while preserving `{{variables}}`. A follow-up cleanup pass trimmed the translator-added trailing newlines, normalized `N/A`, and hand-corrected the product-language terms that were too literal in the first pass (`Bucket Hours`, rate labels, bracket/holiday tabs, and cancel actions). Sanity checks:
  - `node <<'NODE' ... exact-match carry-over / trailing-newline scan for server/public/locales/{de,es,fr,it,nl,pl,pt}/msp/service-catalog.json ... NODE`
  - `jq -r '.configType.options.Bucket.label, .bucketConfig.title, .taxRateDetail.tabs.brackets, .taxRateDetail.tabs.holidays, .serviceSelection.table.rate' server/public/locales/{de,es,fr,it,nl,pl,pt}/msp/service-catalog.json`
- **(2026-04-18, F016)** Generated `server/public/locales/{xx,yy}/msp/service-catalog.json` via the repo-standard pseudo-locale generator: `node scripts/generate-pseudo-locales.cjs`. The run rebuilt `64` pseudo-locale files from `32` English sources; for this feature commit only the new `msp/service-catalog` outputs were staged. Spot-checks on `xx/msp/service-catalog.json` confirmed the expected `11111` fill plus preserved interpolation tokens (for example `taxRates.deleteEntity.withRegion`, `taxRateDetail.subtitle`, `serviceForm.taxRateOption.label`, and `serviceDetail.baseRate.summary`).
- **(2026-04-18, F017)** Ran the targeted Italian accent audit on `server/public/locales/it/msp/service-catalog.json` using the standard dropped-accent scan: `rg -n '\\b(puo|gia|verra|funzionalita|perche|cosi|piu|e necessario|e possibile|e richiesto|e richiesta|e configurato|e configurata)\\b' server/public/locales/it/msp/service-catalog.json`. The grep returned no matches. Spot checks on the higher-risk strings also confirmed the corrected accented output is present (`Sì`, `Festività`, `Configurazione pacchetto ore`, and the bucket-period mismatch copy).
- **(2026-04-18, F018)** Updated `packages/core/src/lib/i18n/config.ts` so the `/msp/settings` route now loads both `msp/service-catalog` and `features/billing` alongside the existing MSP settings namespaces. This closes the route-loading requirement for the new namespace and for the shared `useBillingFrequencyOptions()` hook used by `BucketServiceConfigPanel`.
