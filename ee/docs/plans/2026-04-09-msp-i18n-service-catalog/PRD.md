# PRD — MSP i18n: Service Catalog & Tax Rate Management

- Slug: `2026-04-09-msp-i18n-service-catalog`
- Date: `2026-04-09`
- Status: Draft

## Summary

Extract hardcoded English strings from 14 service-catalog and tax-rate-management components in `packages/billing/src/components/billing-dashboard/`, create the `msp/service-catalog` namespace, wire `useTranslation()`, and generate translations for 7 languages plus 2 pseudo-locales.

## Problem

MSP operators configuring services, rate tiers, tax rates, and billing types see an entirely English UI regardless of their locale preference. These settings screens are used during initial tenant setup and ongoing catalog maintenance, so they must reflect the user's chosen language.

## Goals

1. Create `en/msp/service-catalog.json` namespace with all extracted keys.
2. Wire all 14 component files with `useTranslation('msp/service-catalog')`.
3. Generate translations for 7 production locales (de, es, fr, it, nl, pl, pt) plus 2 pseudo-locales (xx, yy).
4. Register `msp/service-catalog` in `ROUTE_NAMESPACES` for `/msp/settings`.
5. Zero regressions with `msp-i18n-enabled` flag OFF.

## Non-goals

- Translating server-side actions, API responses, or error messages from the backend.
- Refactoring component architecture or consolidating the two `ServiceConfigurationPanel` files.
- Translating sub-components imported from other packages (e.g., `TaxComponentEditor`, `TaxThresholdEditor`, `TaxHolidayManager`).
- Translating client-portal-facing billing views (those use `features/billing.json`).

## In scope: shared enum label migration (carried over from contract-lines batch)

The contract-lines batch (shipped 2026-04-14) introduced a localized option-hook pattern for shared billing enums. See [`.ai/translation/enum-labels-pattern.md`](../../../../.ai/translation/enum-labels-pattern.md) for the full recipe. This batch owns **one** carried-over call site:

| File | Line | Current import | Target hook |
|---|---|---|---|
| `service-configurations/BucketServiceConfigPanel.tsx` | 116 | `BILLING_FREQUENCY_OPTIONS` from `@alga-psa/billing/constants/billing` | `useBillingFrequencyOptions` from `@alga-psa/billing/hooks/useBillingEnumOptions` |

Migration is mechanical: replace the import, call `const billingFrequencyOptions = useBillingFrequencyOptions();` at the top of the component body, and pass `billingFrequencyOptions` into the `<CustomSelect>`. The `features/billing` namespace is already loaded on `/msp/billing` and `/client-portal/billing`; if `BucketServiceConfigPanel` renders under `/msp/settings`, add `features/billing` to that route entry in `packages/core/src/lib/i18n/config.ts` alongside the `msp/service-catalog` registration.

### Local enum constants (not the shared pattern — translate in-place)

`ConfigurationTypeSelector`, `HourlyServiceConfigPanel`, `ServiceForm`, and `FixedServiceConfigPanel` also contain module-level constant arrays with hardcoded English labels (`CONFIGURATION_TYPE_OPTIONS`, `userTypeOptions`, billing-method options, `alignmentOptions`). These are **component-local** and should NOT be extracted into the shared `useBillingEnumOptions` hook. Instead:

1. Move the array inside the component body so it has access to `t()`.
2. Keep value fields untranslated (data identifiers); wrap each `label` with `t('service-catalog.<section>.options.<value>', { defaultValue: '...' })`.
3. If the same array is used by multiple sibling components in this batch, extract a small hook colocated with them (e.g., `useUserTypeRateOptions()` in `service-configurations/` or nearby).

The dividing line: shared across feature areas → published hook in `packages/billing/src/hooks/`; local to one feature area → inline `t()` or a hook living in the same directory.

## File Inventory

| # | Component | Path (relative to `packages/billing/src/components/billing-dashboard/`) | LOC | Est. Strings | Key content |
|---|-----------|-------------------------------------------------------------------------|-----|-------------|-------------|
| 1 | TaxRates.tsx | `TaxRates.tsx` | 510 | ~45-65 | Tax rate CRUD, table columns, dialog, validation |
| 2 | UsageServiceConfigPanel.tsx | `service-configurations/UsageServiceConfigPanel.tsx` | 386 | ~30-45 | Usage-based config, tiered pricing, validation |
| 3 | ServiceRateTiers.tsx | `service-config/ServiceRateTiers.tsx` | 354 | ~25-40 | Rate tier table, CRUD, validation errors |
| 4 | ServiceSelectionDialog.tsx | `service-config/ServiceSelectionDialog.tsx` | 322 | ~25-35 | Service picker dialog, search, quick-add |
| 5 | ServiceConfigurationPanel.tsx (configurations) | `service-configurations/ServiceConfigurationPanel.tsx` | 279 | ~10-15 | Orchestrator panel, save/cancel, bucket overlay |
| 6 | HourlyServiceConfigPanel.tsx | `service-configurations/HourlyServiceConfigPanel.tsx` | 252 | ~25-35 | Hourly config, user type rates, validation |
| 7 | ServiceForm.tsx | `ServiceForm.tsx` | 215 | ~20-30 | Create service form, billing method, tax rate |
| 8 | ConfigurationTypeSelector.tsx | `service-configurations/ConfigurationTypeSelector.tsx` | 184 | ~20-30 | Type picker cards/dropdown, descriptions, warning dialog |
| 9 | TaxRateDetailPanel.tsx | `TaxRateDetailPanel.tsx` | 176 | ~25-35 | Tax rate detail view, tabs, precedence info |
| 10 | BaseServiceConfigPanel.tsx | `service-configurations/BaseServiceConfigPanel.tsx` | 176 | ~15-25 | Base config: rate, quantity, type selector |
| 11 | BucketServiceConfigPanel.tsx | `service-configurations/BucketServiceConfigPanel.tsx` | 171 | ~15-25 | Bucket hours config, rollover, overage rate |
| 12 | ServiceTaxSettings.tsx | `service-config/ServiceTaxSettings.tsx` | 142 | ~10-15 | Per-service tax rate assignment |
| 13 | ServiceConfigurationPanel.tsx (service-config) | `service-config/ServiceConfigurationPanel.tsx` | 135 | ~10-15 | Service detail page shell, unit of measure |
| 14 | FixedServiceConfigPanel.tsx | `service-configurations/FixedServiceConfigPanel.tsx` | 92 | ~10-15 | Fixed price config, proration, alignment |
| | **Total** | | **3,393** | **~285-430** | |

## Namespace Structure

**Namespace file:** `server/public/locales/en/msp/service-catalog.json`

Proposed top-level key groups:

```
taxRates.*           — TaxRates.tsx, TaxRateDetailPanel.tsx
serviceForm.*        — ServiceForm.tsx
serviceConfig.*      — BaseServiceConfigPanel.tsx, ServiceConfigurationPanel (configurations)
fixedConfig.*        — FixedServiceConfigPanel.tsx
hourlyConfig.*       — HourlyServiceConfigPanel.tsx
usageConfig.*        — UsageServiceConfigPanel.tsx
bucketConfig.*       — BucketServiceConfigPanel.tsx
rateTiers.*          — ServiceRateTiers.tsx
serviceSelection.*   — ServiceSelectionDialog.tsx
configType.*         — ConfigurationTypeSelector.tsx
serviceTaxSettings.* — ServiceTaxSettings.tsx
serviceDetail.*      — ServiceConfigurationPanel (service-config)
```

## ROUTE_NAMESPACES Change

Add `msp/service-catalog` to the existing `/msp/settings` route entry:

```typescript
// Before
'/msp/settings': ['common', 'msp/core', 'msp/settings', 'msp/admin', 'msp/email-providers', 'features/projects', 'features/tickets'],

// After
'/msp/settings': ['common', 'msp/core', 'msp/settings', 'msp/admin', 'msp/email-providers', 'features/projects', 'features/tickets', 'msp/service-catalog'],
```

## Acceptance Criteria

- [ ] `en/msp/service-catalog.json` created with all keys (~285-430 strings).
- [ ] All 14 component files wired with `useTranslation('msp/service-catalog')`.
- [ ] All `t()` calls use `{ defaultValue: 'English fallback' }` pattern.
- [ ] 7 production locale files created (de, es, fr, it, nl, pl, pt).
- [ ] Pseudo-locale files created (xx, yy) via `generate-pseudo-locales.cjs`.
- [ ] `validate-translations.cjs` passes (0 errors, 0 warnings).
- [ ] Italian accent audit passes.
- [ ] `ROUTE_NAMESPACES` updated for `/msp/settings`.
- [ ] `msp-i18n-enabled` OFF: all 14 components show English text, no regressions.
- [ ] `msp-i18n-enabled` ON + locale `xx`: all service catalog screens show `11111`.
- [ ] German translations don't overflow in form labels, dialog fields, or table headers.
- [ ] `npm run build` succeeds with no TypeScript errors.
- [ ] Currency values use `useFormatters()` where applicable (rate display in ServiceRateTiers, ServiceSelectionDialog).
- [ ] `BucketServiceConfigPanel.tsx` imports `useBillingFrequencyOptions` from `@alga-psa/billing/hooks/useBillingEnumOptions` (not `BILLING_FREQUENCY_OPTIONS` from the deprecated constants file). Verify with `rg -n 'BILLING_FREQUENCY_OPTIONS|BILLING_FREQUENCY_DISPLAY' packages/billing/src/components/billing-dashboard/service-configurations/`.
- [ ] If `BucketServiceConfigPanel` renders under a route that does not already load `features/billing`, that route entry in `packages/core/src/lib/i18n/config.ts` has been updated.
- [ ] Local enum constants (`CONFIGURATION_TYPE_OPTIONS`, `userTypeOptions`, billing-method options, `alignmentOptions`) have been moved inside their component bodies with `label` fields wrapped in `t()` calls (values remain untranslated).
