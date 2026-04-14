# Scratchpad -- MSP i18n: Contracts Sub-batch

- Plan slug: `2026-04-09-msp-i18n-contracts`
- Created: `2026-04-09`

## What This Is

A mechanical wiring pass: 37 unwired contract components (+ 1 pure-constants file) x `useTranslation('msp/contracts')`. This is the largest sub-batch in the MSP i18n effort at ~14,100 LOC across 38 files spanning 3 directory levels.

## Decisions

- **(2026-04-09)** Use a dedicated `msp/contracts` namespace rather than cramming keys into `features/billing`. Rationale: 38 files with ~800-1200 estimated keys would bloat the billing namespace beyond maintainability. Contracts are a self-contained feature area.
- **(2026-04-09)** `contractsTabs.ts` exports pure string constants (`CONTRACT_SUBTAB_LABELS`, `CONTRACT_TAB_LABELS`). These cannot use `useTranslation()` because the file is not a React component. Translate the consumed values at point-of-use in `Contracts.tsx` and `ClientContractsTab.tsx` instead.
- **(2026-04-14)** **Adopt the shared enum-labels option-hook pattern for all `BILLING_FREQUENCY_*` / `PLAN_TYPE_*` / `CONTRACT_LINE_TYPE_*` call sites owned by this batch.** The contract-lines sub-batch (shipped 2026-04-14) created `packages/billing/src/hooks/useBillingEnumOptions.ts` with `useBillingFrequencyOptions`, `useFormatBillingFrequency`, `useContractLineTypeOptions`, `useFormatContractLineType`, and added `enums.billingFrequency.*` / `enums.contractLineType.*` to `features/billing.json` in all 9 locales. This batch **must** migrate every call site in the PRD's "Shared enum label migration" table rather than translating surrounding labels and leaving the enum values in English. The deprecated `*_DISPLAY` / `*_OPTIONS` exports in `packages/billing/src/constants/billing.ts` were left in place **only** so this batch can flip the switch file-by-file; once all call sites are migrated, remove the deprecated aliases in the same PR as the last migration (or as a final clean-up commit). Pattern reference: `.ai/translation/enum-labels-pattern.md`. Audit command: `rg -n '_DISPLAY|_OPTIONS' packages/billing/src/components/billing-dashboard/contracts/`.
- **(2026-04-14)** **`contractsTabs.ts` migration shape:** keep `CONTRACT_SUBTAB_LABELS` as a value-to-value mapping only if `CONTRACT_LABEL_TO_SUBTAB` still needs it as an identifier lookup. For display, add a `useContractSubtabLabels()` helper colocated with the consumers (`Contracts.tsx` / `ClientContractsTab.tsx`) that returns `{ templates: t('...'), 'client-contracts': t('...'), drafts: t('...') }`. Store/compare tab state by `ContractSubTab` value, never by label. Keys go in `msp/contracts.json` under (suggested) `common.tabs.*` or `enums.contractSubtab.*`.
- **(2026-04-09)** Use `t('key', { defaultValue: 'English fallback' })` signature everywhere for fallback-safety. This matches the pattern established in existing msp/* namespaces.
- **(2026-04-09)** Replace hardcoded `'en-US'` locale in `formatCurrencyFromMinorUnits()` calls with locale from `useFormatters()`. Affects ContractDetail.tsx (invoice columns, PO amount display), ContractOverview.tsx, ReviewContractStep.tsx. The `formatCurrencyFromMinorUnits` utility accepts a locale parameter.
- **(2026-04-09)** Do NOT translate `throw new Error(...)` messages or `console.error()` strings. Only translate user-visible strings rendered in JSX.
- **(2026-04-09)** Use i18next `{{count}}` interpolation for pluralized strings (e.g., `'{{count}} service'` / `'{{count}} services'`; `'{{count}} day'` / `'{{count}} days'`).
- **(2026-04-09)** Use i18next named interpolation for dynamic values in dialog titles (e.g., `t('contractLineRate.title', { name: plan.contract_line_name, defaultValue: 'Set Custom Rate for {{name}}' })`).
- **(2026-04-09)** Ship in sub-batches due to size. Recommended split:
  - Sub-batch A: Namespace creation (F001), translations (F002-F009), route config (F010) -- foundational.
  - Sub-batch B: Large components -- ContractDetail (F011-F015), ContractDialog (F016-F018), ContractTemplateDetail (F019-F021).
  - Sub-batch C: Medium components -- CreateCustomContractLineDialog (F022-F024), ContractLines (F025-F027), AddContractLinesDialog (F028-F029), Contracts/ClientContracts (F030-F034).
  - Sub-batch D: Client wizard steps -- ContractWizard (F035-F036), ContractBasicsStep (F052-F053), service steps (F054-F057), ReviewContractStep (F058-F059).
  - Sub-batch E: Template wizard + small components -- TemplateWizard (F060), template steps (F061-F067), and remaining small components (F037-F051).

## Discoveries / Constraints

- **(2026-04-09)** `ContractDetail.tsx` at 2,330 LOC is the largest single component. It contains 5 tab views, 3 confirmation dialogs, assignment editing with 8+ field types, invoice column definitions, and status formatting. Estimated at 300-400 unique translatable strings. Split into 5 features (F011-F015).
- **(2026-04-09)** Two near-identical dialog files exist: `ContractLineRateDialog.tsx` (99 LOC) and `ContractPlanRateDialog.tsx` (95 LOC). They share the same structure and strings. Consolidate into one feature (F049) for translation efficiency.
- **(2026-04-09)** `formatRenewalModeLabel()` in ContractDetail.tsx returns hardcoded English strings ('Auto-renew', 'Non-renewing', 'Manual renewal'). These need to be translated using `t()` calls at the rendering site, not inside the formatting function (which has no hook access). Extract to translated labels in the component body.
- **(2026-04-09)** `ContractOverview.tsx` has a local `formatFrequency()` that maps frequency keys to display strings ('Weekly', 'Monthly', etc.). These should use `t()` rather than a local map. Same pattern in `ContractHeader.tsx`. **(2026-04-14 update):** For `monthly/quarterly/annually` specifically, use `useFormatBillingFrequency()` from `@alga-psa/billing/hooks/useBillingEnumOptions` so these renderers share the same `features/billing.json` keys as the rest of the contract-lines UI. `weekly` and `biweekly` are not in the shared enum — if `ContractOverview.tsx` needs them, keep a local `t()` lookup for those two values only or extend `BILLING_FREQUENCY_VALUES` (check whether the backend can actually emit them first).
- **(2026-04-09)** `ContractWizard.tsx` defines `STEPS` as a `const` tuple: `['Contract Basics', 'Fixed Fee Services', 'Products', 'Hourly Services', 'Usage-Based Services', 'Review & Create']`. These are passed to `WizardProgress` and `WizardNavigation`. They need to be translated. Options: (a) convert to keys and translate in the component, (b) wrap with `t()` in a useMemo. Option (b) is simpler -- translate at point of use.
- **(2026-04-09)** Same STEPS pattern in `TemplateWizard.tsx` with `TEMPLATE_STEPS`.
- **(2026-04-09)** `BucketOverlayFields.tsx` uses dynamic unit labels ('hours' vs custom unitLabel). The translation key should use interpolation: `t('bucketOverlay.includedLabel', { units: resolvedUnitLabel })`.
- **(2026-04-09)** `TemplateServicePreviewSection.tsx` uses a confirmation dialog with template literal message containing service and preset names. Convert to interpolation: `t('templatePreview.removeConfirmMessage', { serviceName, presetName })`.
- **(2026-04-09)** Several components format currency with hardcoded `'en-US'`: ContractDetail.tsx (lines 1093, 1644, 2126), ContractOverview.tsx (line 19 formatCurrency), ReviewContractStep.tsx (line 62-64). All should be migrated to use `useFormatters().formatCurrency()` or pass the active locale to `formatCurrencyFromMinorUnits()`.
- **(2026-04-09)** `ContractDialog.tsx` is a legacy create/edit dialog (1,386 LOC). It has its own preset picker with rate overrides and service overrides -- complex nested state. Translating it requires careful interpolation for dynamic preset names and rate displays.
- **(2026-04-09)** `ROUTE_NAMESPACES` for `/msp/billing` currently loads: `['common', 'msp/core', 'features/billing', 'msp/reports']`. Adding `'msp/contracts'` is straightforward -- it just appends to the array. Check if `msp/quotes` was also added recently (per the quotes sub-batch plan) to avoid merge conflicts.
- **(2026-04-09)** `ServicePicker.tsx` (56 LOC) and `ServiceCatalogPicker.tsx` (225 LOC) are thin wrappers. The former has 3 translatable strings (placeholder, search placeholder, empty message). The latter has more (~20-30) with search, filter, and selection UI.
- **(2026-04-09)** `QuickStartGuide.tsx` contains substantial prose content (step descriptions, billing model explanations, best practices list). These are long strings but straightforward to extract. Use descriptive keys like `quickStart.step1.description`, `quickStart.bestPractices.item1`.
- **(2026-04-09)** `contractsTabs.ts` (27 LOC, no React) defines `CONTRACT_SUBTAB_LABELS` and `CONTRACT_TAB_LABELS`. These are consumed in `Contracts.tsx` via `CustomTabs` and in `ClientContractsTab.tsx`. The tab component likely accepts string labels, so translate at the consumption point. Do NOT add `useTranslation()` to the .ts constant file.

## Gotchas

- **Shared status labels**: Status labels ('Active', 'Draft', 'Terminated', 'Expired') appear in ContractDetail.tsx, ContractHeader.tsx, ContractForm.tsx, TemplatesTab.tsx, ClientContractsTab.tsx, and Contracts.tsx. Use `common.status.*` keys in the namespace to avoid duplication.
- **Renewal mode labels**: 'Auto-renew', 'Manual renewal', 'Non-renewing' appear in ContractDetail.tsx and ContractBasicsStep.tsx. Use `common.renewal.*` keys.
- **Billing timing labels**: 'In Arrears' / 'In Advance' appear in ContractLineEditDialog.tsx, ContractLines.tsx, ContractTemplateDetail.tsx, and wizard steps. Use `common.billing.timing.*` keys.
- **Currency symbol hardcoding**: `BucketOverlayFields.tsx` hardcodes `$` as the currency symbol prefix (line 136). This should ideally use the contract's currency symbol, but that is a functional change beyond i18n scope. Note it but do not fix.
- **Date formatting**: Several components use `new Intl.DateTimeFormat(undefined, ...)` which already respects browser locale -- no change needed for these. Only the explicit `'en-US'` locale in `formatCurrencyFromMinorUnits` calls needs migration.
- **Large test surface**: 67 features x ~1.5 tests = ~100 test cases. For efficiency, group small-component tests into composite test files (e.g., one test file covering F045-F051 small components).

## Execution Log

- **(2026-04-14)** `F001` completed: created [`server/public/locales/en/msp/contracts.json`](../../../../server/public/locales/en/msp/contracts.json) with the full top-level namespace/group scaffold from the PRD (`common`, `status`, `renewal`, `billing`, `po`, and all component/wizard group buckets). Added initial key population for the first ContractDetail tranche (tabs/cards/dialogs/invoices/common actions/status/fallback labels) so follow-on features can wire to stable keys immediately.
- **(2026-04-14)** Runbook/verification: `jq empty server/public/locales/en/msp/contracts.json`.
- **(2026-04-14)** Constraint: key count is intentionally incremental at this stage; groups are pre-created so subsequent feature commits can append keys without structural churn.
- **(2026-04-14)** `F002` completed: generated [`server/public/locales/fr/msp/contracts.json`](../../../../server/public/locales/fr/msp/contracts.json) from English source using placeholder-safe machine translation (`{{...}}` tokens protected/restored).
- **(2026-04-14)** Verification: `jq empty server/public/locales/fr/msp/contracts.json`.
- **(2026-04-14)** `F003` completed: generated [`server/public/locales/es/msp/contracts.json`](../../../../server/public/locales/es/msp/contracts.json) from English source with placeholder-safe machine translation.
- **(2026-04-14)** Verification: `jq empty server/public/locales/es/msp/contracts.json`.
- **(2026-04-14)** `F004` completed: generated [`server/public/locales/de/msp/contracts.json`](../../../../server/public/locales/de/msp/contracts.json) from English source with placeholder-safe machine translation.
- **(2026-04-14)** Verification: `jq empty server/public/locales/de/msp/contracts.json`.
MD && git add ee/docs/plans/2026-04-09-msp-i18n-contracts/features.json ee/docs/plans/2026-04-09-msp-i18n-contracts/SCRATCHPAD.md server/public/locales/de/msp/contracts.json && git commit -m "feat(F004): add german contracts locale namespace"- **(2026-04-14)** `F005` completed: generated [`server/public/locales/nl/msp/contracts.json`](../../../../server/public/locales/nl/msp/contracts.json) from English source with placeholder-safe machine translation.
- **(2026-04-14)** Verification: `jq empty server/public/locales/nl/msp/contracts.json`.
MD && git add ee/docs/plans/2026-04-09-msp-i18n-contracts/features.json ee/docs/plans/2026-04-09-msp-i18n-contracts/SCRATCHPAD.md server/public/locales/nl/msp/contracts.json && git commit -m "feat(F005): add dutch contracts locale namespace"- **(2026-04-14)** `F006` completed: generated [`server/public/locales/it/msp/contracts.json`](../../../../server/public/locales/it/msp/contracts.json) from English source with placeholder-safe machine translation.
- **(2026-04-14)** Italian accent audit note: machine output preserves accented graphemes where emitted by translator; full strict audit will be enforced again during `F009` (`validate-translations.cjs`).
- **(2026-04-14)** Verification: `jq empty server/public/locales/it/msp/contracts.json`.
- **(2026-04-14)** `F007` completed: generated [`server/public/locales/pl/msp/contracts.json`](../../../../server/public/locales/pl/msp/contracts.json) from English source with placeholder-safe machine translation.
- **(2026-04-14)** Verification: `jq empty server/public/locales/pl/msp/contracts.json`.
- **(2026-04-14)** `F008` completed: ran `node scripts/generate-pseudo-locales.cjs`, which regenerated pseudo-locales including `xx/msp/contracts.json` and `yy/msp/contracts.json`.
- **(2026-04-14)** Verification: `jq empty server/public/locales/xx/msp/contracts.json && jq empty server/public/locales/yy/msp/contracts.json` and spot-check confirmed `xx` values are `11111` patterns.
- **(2026-04-14)** `F009` completed: ran `node scripts/validate-translations.cjs` after adding `msp/contracts` locale files.
- **(2026-04-14)** Validation result: `Errors: 0`, `Warnings: 0`, `PASSED`.
- **(2026-04-14)** `F010` completed: updated `ROUTE_NAMESPACES['/msp/billing']` in `packages/core/src/lib/i18n/config.ts` to preload `msp/contracts` alongside existing billing namespaces.
- **(2026-04-14)** `F011` completed in `ContractDetail.tsx`: wired `useTranslation('msp/contracts')` and translated tab labels (`Overview`, `Contract Lines`, `Pricing Schedules`, `Documents`, `Invoices`), unsaved-changes warning copy, save-success toast/alert copy, system-managed-default informational alert copy, and validation alert heading/field labels.
- **(2026-04-14)** Added corresponding `contractDetail.alerts.*`, `contractDetail.systemManaged.*`, and `contractDetail.validation.*` keys in `server/public/locales/en/msp/contracts.json`.
- **(2026-04-14)** Verification: `npx eslint packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx` (pass; warnings only, no errors).
- **(2026-04-14)** `F012` completed in `ContractDetail.tsx`: translated Contract Details card title, `Contract Name *` and `Description` labels, `No description` fallback, contract-name/description placeholders, and the `System-managed default` badge. Added translated aria-label/title text for edit/save/cancel icon buttons in the details card.
- **(2026-04-14)** Added `contractDetail.detailsCard.*` keys in `server/public/locales/en/msp/contracts.json`.
- **(2026-04-14)** Verification: `npx eslint packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx` (pass; warnings only, no errors).
- **(2026-04-14)** `F013` completed in `ContractDetail.tsx`: localized the Contract Header card title/labels (`Status` / `Assignment Status`, billing frequency, currency, created, last updated), status badges/options (`Active`, `Draft`, `Terminated`, `Expired`), renewal summary labels (`Mode`, `Source`, `Notice`, `Decision Due`), renewal source values (`Tenant defaults`, `Custom settings`), and expired-status note.
- **(2026-04-14)** Migrated this file’s billing-frequency select from deprecated `BILLING_FREQUENCY_OPTIONS` constant to `useBillingFrequencyOptions()` hook.
- **(2026-04-14)** Added `contractDetail.headerCard.*` keys in `server/public/locales/en/msp/contracts.json`.
- **(2026-04-14)** Verification: `npx eslint packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx` (pass; warnings only, no errors).
