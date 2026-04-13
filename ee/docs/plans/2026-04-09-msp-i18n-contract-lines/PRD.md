# PRD — MSP i18n: Contract Lines Sub-batch

- Slug: `2026-04-09-msp-i18n-contract-lines`
- Date: `2026-04-09`
- Status: Pending

## Summary

Extract all hardcoded English strings from the 21 contract-line configuration components in `packages/billing/src/components/billing-dashboard/`, create the `msp/contract-lines` namespace, wire `useTranslation()` throughout, and generate translations for 7 languages + pseudo-locales.

**Total scope: ~350-400 new keys across 21 files.**

## Problem

The contract-line management UI -- preset creation dialog, type-specific configurations (Fixed/Hourly/Usage), service lists, tier editors, and routing components -- contains approximately 350-400 hardcoded English strings. These components are accessed by MSP operators via the billing section and are among the most form-heavy screens in the application. Users with non-English locale preferences see untranslated labels, validation messages, tooltips, section headings, helper text, and button labels throughout the contract-line management workflow.

## Goals

1. Create the `msp/contract-lines.json` namespace with all contract-line-related translation keys
2. Extract every user-visible hardcoded string from all 21 component files
3. Wire all components to consume translations via `useTranslation('msp/contract-lines')`
4. Use `useFormatters()` for any currency formatting where applicable
5. Generate accurate translations for all 7 production languages (en, fr, es, de, nl, it, pl)
6. Generate pseudo-locale files (xx, yy) covering all new keys
7. Validate all locale files pass `validate-translations.cjs`
8. Register `/msp/billing` route additions in `ROUTE_NAMESPACES` to load `msp/contract-lines`
9. Zero regressions -- everything works identically with `msp-i18n-enabled` flag OFF (forced English)

## Non-goals

- Translating billing constants (`BILLING_FREQUENCY_OPTIONS`, `PLAN_TYPE_OPTIONS`, `BILLING_FREQUENCY_DISPLAY`, `PLAN_TYPE_DISPLAY`, `CONTRACT_LINE_TYPE_DISPLAY`) -- those are shared constants used across billing; they belong in a `msp/billing` namespace
- Translating `ServiceCatalogPicker` or `BucketOverlayFields` -- those are shared components used by contracts too, covered separately
- Translating `ServiceConfigurationPanel` in `service-configurations/` -- separate sub-batch
- Translating `FixedContractLineServicesList` or `FixedContractLinePresetServicesList` (in parent `billing-dashboard/` directory, not in `contract-lines/`) -- separate scope
- Translating `DeleteEntityDialog` or `ConfirmationDialog` -- shared UI components
- Adding new languages beyond the existing 7
- Changing the component architecture or data flow

## File Inventory

| # | File | LOC | Strings (est.) | Features |
|---|------|-----|----------------|----------|
| 1 | `ContractLineDialog.tsx` | 1292 | ~80 | F001-F003 |
| 2 | `contract-lines/HourlyContractLineConfiguration.tsx` | 849 | ~55 | F004-F005 |
| 3 | `contract-lines/UsageContractLineConfiguration.tsx` | 738 | ~45 | F006-F007 |
| 4 | `contract-lines/UsageContractLinePresetConfiguration.tsx` | 731 | ~45 | F008-F009 |
| 5 | `contract-lines/HourlyContractLinePresetConfiguration.tsx` | 693 | ~45 | F010-F011 |
| 6 | `contract-lines/UsageContractLinePresetServicesList.tsx` | 537 | ~30 | F012-F013 |
| 7 | `contract-lines/HourlyContractLinePresetServicesList.tsx` | 514 | ~30 | F014-F015 |
| 8 | `contract-lines/GenericContractLineServicesList.tsx` | 513 | ~30 | F016-F017 |
| 9 | `ContractLines.tsx` | 485 | ~25 | F018-F019 |
| 10 | `contract-lines/FixedContractLineConfiguration.tsx` | 434 | ~30 | F020-F021 |
| 11 | `contract-lines/FixedContractLinePresetConfiguration.tsx` | 380 | ~25 | F022-F023 |
| 12 | `contract-lines/ServiceHourlyConfigForm.tsx` | 352 | ~25 | F024-F025 |
| 13 | `contract-lines/ContractLineServiceForm.tsx` | 308 | ~10 | F026 |
| 14 | `contract-lines/ContractLinesOverview.tsx` | 281 | ~20 | F027-F028 |
| 15 | `contract-lines/ServiceTierEditor.tsx` | 206 | ~15 | F029 |
| 16 | `contract-lines/ServiceUsageConfigForm.tsx` | 197 | ~15 | F030 |
| 17 | `contract-lines/ServiceBucketConfigForm.tsx` | 164 | ~12 | F031 |
| 18 | `contract-lines/EditContractLineServiceQuantityDialog.tsx` | 154 | ~12 | F032 |
| 19 | `contract-lines/ContractLineTypeSelector.tsx` | 129 | ~10 | F033 |
| 20 | `contract-lines/ContractLineTypeRouter.tsx` | 79 | ~4 | F034 |
| 21 | `contract-lines/ContractLinePresetTypeRouter.tsx` | 79 | ~4 | F035 |

## Namespace Structure

Namespace: `msp/contract-lines`

```
{
  "dialog": {                          // ContractLineDialog.tsx
    "title": { "add": "...", "edit": "..." },
    "basics": { ... },
    "billingModel": { ... },
    "fixed": { ... },
    "hourly": { ... },
    "usage": { ... },
    "validation": { ... },
    "actions": { ... }
  },
  "overview": { ... },                 // ContractLinesOverview.tsx
  "list": { ... },                     // ContractLines.tsx
  "configuration": {                   // Shared config patterns
    "basics": { ... },
    "fixed": { ... },
    "hourly": { ... },
    "usage": { ... }
  },
  "preset": {                          // Preset-specific variants
    "basics": { ... },
    "fixed": { ... },
    "hourly": { ... },
    "usage": { ... }
  },
  "services": {                        // Service list components
    "generic": { ... },
    "hourlyPreset": { ... },
    "usagePreset": { ... }
  },
  "forms": {                           // Form sub-components
    "hourlyConfig": { ... },
    "usageConfig": { ... },
    "bucketConfig": { ... },
    "tierEditor": { ... },
    "serviceForm": { ... },
    "editQuantity": { ... }
  },
  "typeSelector": { ... },             // ContractLineTypeSelector.tsx
  "router": { ... },                   // Router loading/error states
  "common": {                          // Shared across multiple files
    "validation": { ... },
    "actions": { ... },
    "labels": { ... },
    "errors": { ... }
  }
}
```

## Acceptance Criteria

1. **All 21 files** import `useTranslation` from `@alga-psa/ui/lib/i18n/client` and call `t()` for every user-visible string
2. **Every `t()` call** includes a `defaultValue` with the original English text as fallback
3. **`msp/contract-lines.json`** exists in `server/public/locales/en/` and contains all extracted keys
4. **7 language files** exist in their respective locale directories with accurate translations
5. **Pseudo-locale files** (xx, yy) exist and cover all keys
6. **`validate-translations.cjs`** passes with zero errors for the new namespace
7. **No visual regressions** with `msp-i18n-enabled` OFF -- all components render identically with English defaults
8. **Interpolation** works correctly for dynamic values (e.g., service names, tier numbers, currency amounts)
9. **Validation messages** with interpolated values (e.g., "Service {{index}}: Please select a service") render correctly in all languages
10. **Long translations** (German/Dutch ~30-50% longer) do not cause layout overflow in form labels, buttons, card descriptions, or accordion headers
11. **Tooltip content** is translated (overtime/after-hours info tooltips, rate tooltips)
12. **Table column headers** are translated (Service Name, Billing Frequency, etc.)
13. **Empty state messages** are translated ("No services currently associated...", "Select a contract line to manage its services")
14. **ROUTE_NAMESPACES** updated to load `msp/contract-lines` for billing routes
