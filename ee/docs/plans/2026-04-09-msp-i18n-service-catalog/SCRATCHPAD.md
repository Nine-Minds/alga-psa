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
