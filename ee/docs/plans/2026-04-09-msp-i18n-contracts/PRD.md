# PRD -- MSP i18n: Contracts Sub-batch

- Slug: `2026-04-09-msp-i18n-contracts`
- Date: `2026-04-09`
- Status: Draft

## Summary

Extract all hardcoded English strings from the 38 contract management components, create the `msp/contracts` namespace, wire `useTranslation()`, and generate translations for 7 languages plus 2 pseudo-locales. This is the largest sub-batch in the MSP i18n effort, covering contract detail views, list/tab views, creation wizards, template wizards, pricing schedules, contract lines, service pickers, and quick-start guides.

## Problem

The entire contract management UI -- detail pages, create/edit wizards, template authoring, contract line management, pricing schedules, client assignment editing, invoices, documents, and quick-start guides -- renders English-only text regardless of the user's locale preference. This affects ~14,000 LOC across 38 component files spanning three directory levels. Users who operate in non-English locales see a jarring mix of translated and untranslated UI when navigating from already-translated areas of the MSP portal into contract management.

## Goals

1. Create `server/public/locales/en/msp/contracts.json` with all extracted keys.
2. Wire all 38 component files with `useTranslation('msp/contracts')`.
3. Replace hardcoded `new Intl.NumberFormat('en-US', ...)` calls with `useFormatters()` where applicable.
4. Generate translations for 7 languages (de, en, es, fr, it, nl, pl) plus 2 pseudo-locales (xx, yy) -- 9 locale files total.
5. Register `msp/contracts` in `ROUTE_NAMESPACES` for `/msp/billing`.
6. Pass `validate-translations.cjs` with 0 errors across all 9 locales.
7. Zero regressions with the `msp-i18n-enabled` feature flag OFF.

## Non-goals

- Translating server-side contract actions or API responses.
- Translating `@alga-psa/types` interface constants (e.g., status enums in shared types).
- Refactoring component architecture or splitting large components.
- Translating currency option labels from `@alga-psa/core` (shared constant, separate effort).

## In scope: shared enum label migration (carried over from contract-lines batch)

The contract-lines batch (2026-04-09-msp-i18n-contract-lines, shipped 2026-04-14) adopted a localized option-hook pattern for shared billing enums and migrated every in-scope call site. See [`.ai/translation/enum-labels-pattern.md`](../../../../.ai/translation/enum-labels-pattern.md) for the full recipe and [the contract-lines SCRATCHPAD follow-up note](../2026-04-09-msp-i18n-contract-lines/SCRATCHPAD.md#follow-up-enum-labels-from-alga-psabillingconstantsbilling) for the decision trail.

**The contract-lines batch left the deprecated `BILLING_FREQUENCY_*`, `CONTRACT_LINE_TYPE_*`, and `PLAN_TYPE_*` exports in `packages/billing/src/constants/billing.ts` in place as `@deprecated` backwards-compat shims specifically so this batch can clean them up.** Every import of those constants in this batch's file list must be migrated to the published hooks from `@alga-psa/billing/hooks/useBillingEnumOptions`:

| Hook | Replaces |
|---|---|
| `useBillingFrequencyOptions()` | `BILLING_FREQUENCY_OPTIONS` in `<CustomSelect options={...}>` |
| `useFormatBillingFrequency()` | `BILLING_FREQUENCY_DISPLAY[value]` in table `render` callbacks and inline label lookups |
| `useContractLineTypeOptions()` | `PLAN_TYPE_OPTIONS` / `CONTRACT_LINE_TYPE_OPTIONS` in `<CustomSelect>` and filter dropdowns |
| `useFormatContractLineType()` | `PLAN_TYPE_DISPLAY[value]` / `CONTRACT_LINE_TYPE_DISPLAY[value]` in table renderers |

**Call sites this batch owns** (enumerated during the contract-lines audit on 2026-04-14):

| File | Line(s) | Current import | Target hook |
|---|---|---|---|
| `ContractForm.tsx` | 142 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `ContractDialog.tsx` | 588 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `ContractDialog.tsx` | 773 | `CONTRACT_LINE_TYPE_DISPLAY` (option-builder) | `useContractLineTypeOptions` |
| `ContractDetail.tsx` | 1510 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `ContractTemplateDetail.tsx` | 709, 790 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `wizard-steps/ContractBasicsStep.tsx` | 260 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `wizard-steps/ReviewContractStep.tsx` | 22 (import), 148 | `BILLING_FREQUENCY_OPTIONS` (lookup by value) | `useBillingFrequencyOptions` + `.find(opt => opt.value === ...)` |
| `wizard-steps/ReviewContractStep.tsx` | 303, 387, 429 | `BILLING_FREQUENCY_DISPLAY[...]` (override display in three review blocks) | `useFormatBillingFrequency` |
| `template-wizard/steps/TemplateContractBasicsStep.tsx` | 81 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `AddContractLinesDialog.tsx` | 392 | `CONTRACT_LINE_TYPE_DISPLAY` (option-builder) | `useContractLineTypeOptions` |
| `CreateCustomContractLineDialog.tsx` | 854 | `BILLING_FREQUENCY_OPTIONS` | `useBillingFrequencyOptions` |
| `BillingFrequencyOverrideSelect.tsx` | 24, 27, 72 | `BILLING_FREQUENCY_OPTIONS` + `BILLING_FREQUENCY_DISPLAY` | `useBillingFrequencyOptions` + `useFormatBillingFrequency` |

Line numbers are as of 2026-04-14; expect small drift if this batch runs later. Use the audit greps in [`.ai/translation/enum-labels-pattern.md`](../../../../.ai/translation/enum-labels-pattern.md#finding-latent-gaps) to recover exact positions.

**`contractsTabs.ts` (Templates / Client Contracts / Drafts):** The `CONTRACT_SUBTAB_LABELS` constant is the same anti-pattern but has a wrinkle — it is used both as display text and as an identifier in `CONTRACT_LABEL_TO_SUBTAB`. Migrate by (a) keeping `CONTRACT_SUBTAB_LABELS` as value-to-value mapping for the identifier lookup, (b) adding enum keys under `msp/contracts.json` `enums.contractSubtab.*` (or `common.tabs.*` in the namespace), and (c) adding a small `useContractSubtabLabels()` helper inside `Contracts.tsx` / `ClientContractsTab.tsx` consumers that maps `ContractSubTab` values to localized labels via `t()`. Do NOT add `useTranslation` to `contractsTabs.ts` itself (it is not a React file).

### Cross-package cleanup: `ClientServiceOverlapMatrix` + `getPlanTypeDisplayAsync`

One more latent consumer lives **outside this batch's normal file list** but belongs in the same cleanup PR that removes the deprecated constants. The already-shipped `msp-i18n-clients` batch wired `ClientServiceOverlapMatrix.tsx` to `useTranslation('msp/clients')`, but its contract-line-type badge still renders English because the label arrives via a server-action RPC with a hardcoded English map:

| File | Line | Issue |
|---|---|---|
| `packages/clients/src/lib/billingHelpers.ts` | 366 | `getPlanTypeDisplayAsync` is a `withAuthCheck` server action that returns `{ Fixed: 'Fixed', Hourly: 'Hourly', Usage: 'Usage Based' }`. No tenant/session dependency — it has no business being a server action. |
| `packages/clients/src/components/clients/ClientServiceOverlapMatrix.tsx` | 41-46 | `useEffect` loads `planTypeDisplay` state from `getPlanTypeDisplayAsync()` and renders it in the type badge. |

**Migration:**
1. Delete `getPlanTypeDisplayAsync` from `billingHelpers.ts` (verify no other consumers: `rg -n 'getPlanTypeDisplayAsync' packages/ server/ ee/`).
2. In `ClientServiceOverlapMatrix.tsx`: remove the import, the `planTypeDisplay` state, the `useEffect`, and the `setPlanTypeDisplay` call. Import `useFormatContractLineType` from `@alga-psa/billing/hooks/useBillingEnumOptions`, add `const formatContractLineType = useFormatContractLineType();` at the top of the component body, and replace the `planTypeDisplay[value]` lookup with `formatContractLineType(value)`.
3. Verify `features/billing` is loaded on whichever route renders the overlap matrix. If that route currently only loads `msp/clients`, add `features/billing` to its `ROUTE_NAMESPACES` entry in `packages/core/src/lib/i18n/config.ts`.
4. Run `node scripts/validate-translations.cjs` and confirm `rg -n 'getPlanTypeDisplayAsync'` returns no matches.

No new translation keys are needed — `enums.contractLineType.*` already exists in `features/billing.json` across all 9 locales from the contract-lines batch. This cleanup is ~30 LOC across 2 files and should land in the same PR that removes the deprecated `*_DISPLAY` / `*_OPTIONS` exports from `packages/billing/src/constants/billing.ts` (see acceptance criterion 14).

## File Inventory

All files are under `packages/billing/src/components/billing-dashboard/contracts/`.

### Main contract components (25 files)

| # | File | LOC | Est. Strings | Category |
|---|------|-----|-------------|----------|
| 1 | `ContractDetail.tsx` | 2,330 | ~300-400 | Full detail view: overview tab, edit form, assignment editing, renewal, PO, invoices, documents, quick actions, confirmation dialogs |
| 2 | `ContractDialog.tsx` | 1,386 | ~150-200 | Legacy create/edit dialog: form fields, preset picker, rate overrides |
| 3 | `ContractTemplateDetail.tsx` | 1,318 | ~150-200 | Template detail view: metadata, lines, services, scheduling |
| 4 | `CreateCustomContractLineDialog.tsx` | 1,024 | ~100-140 | Custom line creation: type picker, service config, bucket overlay |
| 5 | `ContractLines.tsx` | 1,027 | ~100-140 | Contract lines list: expand/collapse, service configs, inline editing, bucket overlays |
| 6 | `AddContractLinesDialog.tsx` | 919 | ~80-120 | Add lines dialog: search, filter, preset selection, rate overrides |
| 7 | `Contracts.tsx` | 862 | ~80-120 | Main list view: sub-tabs (templates/client/drafts), search, row actions, wizard triggers |
| 8 | `ClientContractsTab.tsx` | 822 | ~80-110 | Client contracts list: columns, status badges, search, actions, terminate dialog |
| 9 | `ContractWizard.tsx` | 805 | ~40-60 | Client contract wizard shell: step definitions, validation, save/draft, confirmation dialogs |
| 10 | `ContractOverview.tsx` | 351 | ~40-55 | Contract overview card: stats, line cards, service list, empty states |
| 11 | `PricingScheduleDialog.tsx` | 302 | ~35-50 | Pricing schedule create/edit dialog |
| 12 | `PricingSchedules.tsx` | 287 | ~30-45 | Pricing schedules list: columns, actions, empty state |
| 13 | `TemplatesTab.tsx` | 247 | ~30-40 | Templates list: columns, status badges, search, actions |
| 14 | `ServiceCatalogPicker.tsx` | 225 | ~20-30 | Service catalog picker: search, filter, selection |
| 15 | `ContractForm.tsx` | 197 | ~25-35 | Simple contract edit form: name, description, status, frequency, currency |
| 16 | `QuickStartGuide.tsx` | 195 | ~35-50 | Quick start guide: 3-step walkthrough, best practices |
| 17 | `BucketOverlayFields.tsx` | 187 | ~15-25 | Bucket overlay config: included units, overage rate, rollover |
| 18 | `ContractLineEditDialog.tsx` | 172 | ~20-25 | Contract line edit dialog: rate, billing timing |
| 19 | `ContractHeader.tsx` | 163 | ~20-30 | Contract header bar: status badge, stats row, PO alert |
| 20 | `ContractDetailSwitcher.tsx` | 156 | ~8-12 | Router switcher: loading, error, contract type detection |
| 21 | `ContractLineRateDialog.tsx` | 99 | ~8-12 | Rate dialog (contract lines) |
| 22 | `ContractPlanRateDialog.tsx` | 95 | ~8-12 | Rate dialog (plans) |
| 23 | `BillingFrequencyOverrideSelect.tsx` | 78 | ~8-12 | Billing frequency override select |
| 24 | `ServicePicker.tsx` | 56 | ~5-8 | Service search/select wrapper |
| 25 | `contractsTabs.ts` | 27 | 0 | Pure constants -- translate at point of use |

### Wizard steps (6 files)

| # | File | LOC | Est. Strings | Category |
|---|------|-----|-------------|----------|
| 26 | `wizard-steps/ContractBasicsStep.tsx` | 741 | ~80-120 | Client/template picker, dates, renewal, PO, billing config |
| 27 | `wizard-steps/UsageBasedServicesStep.tsx` | 466 | ~50-70 | Usage service picker, unit rate, bucket overlay |
| 28 | `wizard-steps/HourlyServicesStep.tsx` | 322 | ~35-50 | Hourly service picker, rate, minimum/rounding, bucket overlay |
| 29 | `wizard-steps/FixedFeeServicesStep.tsx` | 307 | ~30-45 | Fixed fee service picker, base rate, proration |
| 30 | `wizard-steps/ReviewContractStep.tsx` | 466 | ~60-80 | Full contract review: basics, services by type, PO, summary |
| 31 | `wizard-steps/ProductsStep.tsx` | 242 | ~25-35 | Product service picker, quantity, rate |

### Template wizard (8 files)

| # | File | LOC | Est. Strings | Category |
|---|------|-----|-------------|----------|
| 32 | `template-wizard/TemplateWizard.tsx` | 383 | ~30-40 | Template wizard shell: steps, validation, save |
| 33 | `template-wizard/steps/TemplateFixedFeeServicesStep.tsx` | 303 | ~30-40 | Template fixed fee services |
| 34 | `template-wizard/steps/TemplateHourlyServicesStep.tsx` | 252 | ~25-35 | Template hourly services |
| 35 | `template-wizard/steps/TemplateReviewContractStep.tsx` | 235 | ~30-40 | Template review step |
| 36 | `template-wizard/steps/TemplateUsageBasedServicesStep.tsx` | 229 | ~25-35 | Template usage-based services |
| 37 | `template-wizard/TemplateServicePreviewSection.tsx` | 170 | ~15-20 | Service preview with remove confirmation |
| 38 | `template-wizard/steps/TemplateProductsStep.tsx` | 168 | ~15-20 | Template products step |
| 39 | `template-wizard/steps/TemplateContractBasicsStep.tsx` | 97 | ~12-18 | Template basics: name, notes, billing frequency |

| | **Total** | **~14,100** | **~1,400-2,200** | |

> String estimates use ~0.10-0.15 strings/LOC. Previous batches showed ~0.15 strings/LOC overestimates by 1.5-2x. The realistic target is ~800-1,200 unique keys.

## Namespace Structure

```
msp/contracts.json
  common.*                 -- Shared labels reused across many components (Cancel, Save, Delete, Edit, Back, Saving..., etc.)
  status.*                 -- Contract status labels (Active, Draft, Terminated, Expired) and assignment status labels
  renewal.*                -- Renewal mode labels, notice period, decision due, tenant defaults
  billing.*                -- Billing frequency labels, timing (arrears/advance), cadence owner
  po.*                     -- PO required, PO number, PO amount labels
  contractDetail.*         -- ContractDetail.tsx: tabs, cards, edit form, quick actions, confirmation dialogs
  contractHeader.*         -- ContractHeader.tsx: stats row, PO alert
  contractOverview.*       -- ContractOverview.tsx: stats, line cards, empty states
  contractDialog.*         -- ContractDialog.tsx: form fields, preset picker
  contractForm.*           -- ContractForm.tsx: simple edit form
  contractLines.*          -- ContractLines.tsx: line list, expand/collapse, inline editing, bucket configs
  contractLineEdit.*       -- ContractLineEditDialog.tsx: rate, timing
  contractLineRate.*       -- ContractLineRateDialog.tsx, ContractPlanRateDialog.tsx
  addLines.*               -- AddContractLinesDialog.tsx: search, filter, preset selection
  createCustomLine.*       -- CreateCustomContractLineDialog.tsx: type picker, service config
  pricingSchedules.*       -- PricingSchedules.tsx + PricingScheduleDialog.tsx
  contractsList.*          -- Contracts.tsx: tabs, search, row actions
  clientContracts.*        -- ClientContractsTab.tsx: columns, search, terminate
  templatesTab.*           -- TemplatesTab.tsx: columns, search, actions
  detailSwitcher.*         -- ContractDetailSwitcher.tsx: loading, error states
  templateDetail.*         -- ContractTemplateDetail.tsx: metadata, lines, services
  quickStart.*             -- QuickStartGuide.tsx: steps, best practices
  servicePicker.*          -- ServicePicker.tsx, ServiceCatalogPicker.tsx
  bucketOverlay.*          -- BucketOverlayFields.tsx: included units, overage, rollover
  frequencyOverride.*      -- BillingFrequencyOverrideSelect.tsx
  wizard.*                 -- ContractWizard.tsx: step labels, validation, save/draft dialogs
  wizardBasics.*           -- ContractBasicsStep.tsx: client picker, dates, renewal, PO
  wizardFixed.*            -- FixedFeeServicesStep.tsx: service picker, rate, proration
  wizardProducts.*         -- ProductsStep.tsx: product picker, quantity
  wizardHourly.*           -- HourlyServicesStep.tsx: hourly rate, minimum, rounding
  wizardUsage.*            -- UsageBasedServicesStep.tsx: unit rate, measure
  wizardReview.*           -- ReviewContractStep.tsx: all sections summary
  templateWizard.*         -- TemplateWizard.tsx: step labels, validation
  templateBasics.*         -- TemplateContractBasicsStep.tsx: name, notes, frequency
  templateFixed.*          -- TemplateFixedFeeServicesStep.tsx
  templateProducts.*       -- TemplateProductsStep.tsx
  templateHourly.*         -- TemplateHourlyServicesStep.tsx
  templateUsage.*          -- TemplateUsageBasedServicesStep.tsx
  templateReview.*         -- TemplateReviewContractStep.tsx
  templatePreview.*        -- TemplateServicePreviewSection.tsx
```

## ROUTE_NAMESPACES Changes

The `/msp/billing` route entry should add `msp/contracts`:

```typescript
'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports', 'msp/contracts'],
```

## Acceptance Criteria

1. `server/public/locales/en/msp/contracts.json` exists and contains all extracted keys.
2. All 37 UI component files (excluding `contractsTabs.ts`) import `useTranslation` from `@alga-psa/ui/lib/i18n/client` and use `t('key', { defaultValue: '...' })` for all user-visible strings.
3. Currency and date formatting uses `useFormatters()` where applicable, replacing hardcoded `new Intl.NumberFormat('en-US', ...)` calls in ContractDetail.tsx, ContractOverview.tsx, ReviewContractStep.tsx, and related components.
4. All 9 locale files exist: `{de,en,es,fr,it,nl,pl,xx,yy}/msp/contracts.json`.
5. `validate-translations.cjs` passes with 0 errors and 0 warnings for `msp/contracts` across all 9 locales.
6. Italian translations use correct accents (verified by accent audit).
7. Pseudo-locale `xx` shows `11111` patterns for visual QA.
8. `ROUTE_NAMESPACES` in `packages/core/src/lib/i18n/config.ts` includes `msp/contracts` in the `/msp/billing` entry.
9. `npm run build` succeeds with no TypeScript errors.
10. No hardcoded English strings remain in the 37 wired component files (verified by grep for bare string literals in JSX).
11. Interpolation variables (e.g., `{{count}}`, `{{name}}`) are used for dynamic values in pluralized or parameterized strings rather than template literals.
12. `contractsTabs.ts` string constants are translated at their consumption point via a `useContractSubtabLabels()` helper in `Contracts.tsx` / `ClientContractsTab.tsx`, not in the constant definition file. The `CONTRACT_LABEL_TO_SUBTAB` value-to-value mapping stays intact for identifier lookup.
13. All call sites in the "Shared enum label migration" table above import hooks from `@alga-psa/billing/hooks/useBillingEnumOptions` and use the result in `<CustomSelect>` / `render` callbacks. Zero imports of `BILLING_FREQUENCY_OPTIONS`, `BILLING_FREQUENCY_DISPLAY`, `PLAN_TYPE_OPTIONS`, `PLAN_TYPE_DISPLAY`, or `CONTRACT_LINE_TYPE_DISPLAY` remain in the files owned by this batch (verify with `rg -n '_DISPLAY|_OPTIONS' packages/billing/src/components/billing-dashboard/contracts/`).
14. After this batch merges, the `@deprecated` aliases in `packages/billing/src/constants/billing.ts` should be removed (leaving only `BILLING_FREQUENCY_VALUES`, `CONTRACT_LINE_TYPE_VALUES`, `*_LABEL_DEFAULTS`, and the TypeScript types). If any consumer outside the billing package still imports them, flag it and migrate in a follow-up — do not leave stale deprecated exports indefinitely.
