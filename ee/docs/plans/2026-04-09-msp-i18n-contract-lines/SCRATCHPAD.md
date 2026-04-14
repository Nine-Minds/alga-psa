# Scratchpad -- MSP i18n: Contract Lines Sub-batch

- Plan slug: `2026-04-09-msp-i18n-contract-lines`
- Created: `2026-04-09`

## Decisions

- (2026-04-09) **Namespace name**: `msp/contract-lines` -- scoped to the contract-line management UI specifically, not the broader billing section. This keeps the file manageable at ~350-400 keys.
- (2026-04-09) **Billing constants NOT translated here**: `BILLING_FREQUENCY_OPTIONS`, `PLAN_TYPE_OPTIONS`, `BILLING_FREQUENCY_DISPLAY`, `PLAN_TYPE_DISPLAY`, `CONTRACT_LINE_TYPE_DISPLAY`, and `BILLING_TIMING_OPTIONS` are defined in `@alga-psa/billing/constants/billing`. They supply option labels consumed by multiple areas (contracts, invoices, billing dashboard). Translating them belongs in a shared `msp/billing` namespace or the constants themselves need to return translation keys. For this batch, the components will translate the surrounding labels but leave the constant-driven option values as-is.
- (2026-04-09) **BILLING_TIMING_OPTIONS**: The two options ("Arrears -- invoice after the period closes", "Advance -- invoice at the start of the period") are defined locally in both `ContractLineDialog.tsx` and `FixedContractLineConfiguration.tsx`. These SHOULD be translated inline in this batch since they are not shared constants.
- (2026-04-09) **User type options**: The `userTypeOptions` array (Technician, Engineer, Consultant, Project Manager, Administrator) is defined locally in `ServiceHourlyConfigForm.tsx` and both hourly configuration files. These should be translated in this namespace.
- (2026-04-09) **Cadence owner options**: `CADENCE_OWNER_OPTIONS` in `FixedContractLineConfiguration.tsx` are local and should be translated. They include both `label` and `description` fields.
- (2026-04-09) **Currency symbol ($)**: The `$` prefix shown in rate input fields is rendered as a static visual indicator (not a formatted currency value). It should remain hardcoded since it represents the input prefix, not a translated string. Actual currency formatting should use `useFormatters()` where full monetary values are displayed.
- (2026-04-09) **Duplicate strings across files**: Many contract-line and preset configuration files share identical strings (e.g., "Contract Line Basics", "Reset", "Save Changes", "Saving...", "Please correct the following:"). Use shared keys under `common.*` in the namespace to avoid duplication.

## Discoveries / Constraints

### Component Structure
- (2026-04-09) The 21 files split into two parallel hierarchies: contract-line configurations (operating on actual contract lines) and preset configurations (operating on reusable templates). The UI text differs slightly ("Contract Line" vs "Contract Line Preset"), requiring separate but similar keys.
- (2026-04-09) `ContractLineTypeRouter.tsx` and `ContractLinePresetTypeRouter.tsx` are thin routing components with only 3-4 translatable strings each (loading text, error messages). They could potentially share a common `router.*` key group.
- (2026-04-09) `ContractLineDialog.tsx` is the largest file (1292 lines) and contains render functions for Fixed/Hourly/Usage configs, each with its own info alerts, service lists, labels, and empty states. This needs careful key organization to avoid a flat wall of keys.
- (2026-04-09) `ContractLines.tsx` is the legacy top-level view that manages both contract lines AND their services in a two-panel layout. It has its own set of column headers and action menus distinct from `ContractLinesOverview.tsx`.
- (2026-04-09) `GenericContractLineServicesList.tsx` uses `BILLING_METHOD_OPTIONS` defined locally as a const -- these labels ("Fixed Price", "Hourly", "Usage Based") should be translated.

### Interpolation Patterns
- (2026-04-09) Service index in validation: `Service ${index + 1}: Please select a service` -- needs `{{index}}` interpolation.
- (2026-04-09) Card title pattern: `Edit Contract Line: ${plan?.contract_line_name || '...'} (Hourly)` -- needs `{{name}}` interpolation and the type suffix.
- (2026-04-09) Tier overlap messages: `Tier ${i + 1} overlaps with Tier ${i + 2}` -- needs `{{tier1}}` and `{{tier2}}` interpolation.
- (2026-04-09) Rate summary: `${rate} / ${unit}` -- needs `{{rate}}` and `{{unit}}` interpolation.
- (2026-04-09) Services heading: `Services for ${contractLines.find(...)?.contract_line_name}` -- needs `{{name}}` interpolation.
- (2026-04-09) Delete toast: `Contract line deleted successfully` -- simple string, no interpolation.
- (2026-04-09) "Add Selected (N) Services" button has count interpolation: needs `{{count}}`.
- (2026-04-09) Non-hourly service message: `This service (Billing Method: ${billing_method}) cannot be configured...` -- needs `{{method}}` interpolation.

### Shared Components (Out of Scope)
- (2026-04-09) `ServiceCatalogPicker` -- used in ContractLineDialog for selecting services. Has its own translatable strings but belongs to a shared component namespace.
- (2026-04-09) `BucketOverlayFields` -- used for bucket configuration in hourly/usage presets. Shared with contracts.
- (2026-04-09) `ServiceConfigurationPanel` -- used by ContractLineServiceForm to render the full config UI. Separate sub-batch.
- (2026-04-09) `DeleteEntityDialog` -- shared UI component with its own translation needs.
- (2026-04-09) `ConfirmationDialog` -- shared UI component used by preset service lists for unsaved changes warning.
- (2026-04-09) `DataTable` -- column definitions pass translated strings, but the DataTable component itself is shared.

### Potential Gotchas
- (2026-04-09) `ServiceBucketConfigForm.tsx` does dynamic pluralization (`pluralizeUnit()`) by appending 's' to unit names. This naive pluralization will NOT work for non-English languages. The translation keys should use ICU plural syntax or separate singular/plural keys. For this batch, keep the pluralization in the key name pattern and let translators handle it.
- (2026-04-09) Several files use `toast.success()` and `handleError()` with hardcoded English messages. These need translation but the toast calls happen in async handlers, not in JSX. The `t()` function from `useTranslation` is available in the component scope and can be used in callbacks.
- (2026-04-09) `FixedContractLineServicesList` and `FixedContractLinePresetServicesList` are imported from the parent `billing-dashboard/` directory (not the `contract-lines/` subdirectory). They are OUT OF SCOPE for this batch per the file list.

## Execution Order (Recommended)

1. Create `msp/contract-lines.json` English namespace file (F036)
2. Start with smaller/simpler files: routers (F034-F035), type selector (F033), edit quantity dialog (F032)
3. Form sub-components: ServiceTierEditor (F029), ServiceUsageConfigForm (F030), ServiceBucketConfigForm (F031), ServiceHourlyConfigForm (F024-F025)
4. Service list components: GenericContractLineServicesList (F016-F017), preset service lists (F012-F015)
5. Configuration components: Fixed (F020-F023), Usage (F006-F009), Hourly (F004-F005, F010-F011)
6. Top-level components: ContractLineServiceForm (F026), ContractLines (F018-F019), ContractLinesOverview (F027-F028)
7. ContractLineDialog (F001-F003) -- largest file, do last
8. Generate translations (F037), pseudo-locales (F038), validate (F039), update routes (F040)

## Commands / Runbooks

- **Validate translations**: `node scripts/validate-translations.cjs`
- **Generate pseudo-locales**: `npx ts-node scripts/generate-pseudo-locale.ts --locale xx --fill "1111"`
- **Count keys**: `node -e "const o=JSON.parse(require('fs').readFileSync('server/public/locales/en/msp/contract-lines.json'));const c=(o,p='')=>{let n=0;for(const[k,v]of Object.entries(o)){if(typeof v==='object'&&v!==null)n+=c(v,p+k+'.');else n++}return n};console.log(c(o))"`
- **Visual QA**: Enable `msp-i18n-enabled` flag locally, switch to `xx` locale, navigate to Billing > Contract Lines and exercise all configuration screens

## Progress Log

- (2026-04-14) `F001` completed in `ContractLineDialog.tsx` by wiring `useTranslation('msp/contract-lines')` and translating dialog title, basics labels/placeholders, and validation prefix using `t(..., { defaultValue })`.
- (2026-04-14) Preemptively translated additional `ContractLineDialog.tsx` strings for `F002`/`F003` in the same pass to minimize repeated churn in a 1k+ LOC file; feature flags will still be advanced one-by-one in checklist order.
- (2026-04-14) Validation errors in `validateForm()` now use interpolation-based i18n keys (for example `Service {{index}}...`) to align with acceptance criteria for dynamic validation text.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/ContractLineDialog.tsx` (warnings only, no errors).
- (2026-04-14) `F002` covered by the same `ContractLineDialog.tsx` translation pass: billing model chooser heading/description, fixed/hourly/usage card title+description strings, billing timing option labels, and fixed vs non-fixed billing timing helper text are now `t()` backed.
- (2026-04-14) `F003` covered in `ContractLineDialog.tsx`: fixed/hourly/usage config headings, alerts, service labels/placeholders, rate/unit/proration copy, bucket recommendation labels, empty states, indexed service labels, and footer action labels (`Cancel`, submit variants, saving state) are now translated with defaults.
- (2026-04-14) `F004` implemented in `contract-lines/HourlyContractLineConfiguration.tsx`: added `useTranslation('msp/contract-lines')`; translated plan basics card title with `{{name}}`, basics heading/description/labels/placeholders, plan-wide hourly settings accordion trigger text, overtime labels + tooltip + helper copy, and after-hours labels + tooltip + helper copy.
- (2026-04-14) Validation strings for plan-wide hourly settings (`overtimeRate`, `overtimeThreshold`, `afterHoursMultiplier`) now use i18n keys; interpolation paths are ready for locale coverage.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/HourlyContractLineConfiguration.tsx` (warnings only, no errors).
- (2026-04-14) `F005` covered in `contract-lines/HourlyContractLineConfiguration.tsx`: translated service rates card title, fallback service name (`Service ID: {{id}}`), non-hourly configurability message with `{{method}}`, reset/save labels, sticky save button/loading text, manage services card title, empty states, and save error fallbacks.
- (2026-04-14) `F006` implemented in `contract-lines/UsageContractLineConfiguration.tsx`: wired `useTranslation('msp/contract-lines')`, translated usage plan basics card title with `{{name}} (Usage)`, basics section heading/description/labels/placeholders, and reset/save button labels including saving state.
- (2026-04-14) Plan basics validation/save fallback strings in the same component now use translated defaults.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/UsageContractLineConfiguration.tsx` (warnings only, no errors).
- (2026-04-14) `F007` covered in `contract-lines/UsageContractLineConfiguration.tsx`: translated service pricing card title, accordion summaries (`Tiered Pricing ({{count}} tiers)`, `Not Set`, `Loading...`, `{{rate}} / {{unit}}`, `Loading configuration...`), save-all CTA/loading text, manage-services card title, empty-state helper copy, and all save/validation error strings.
- (2026-04-14) `F008` implemented in `contract-lines/UsageContractLinePresetConfiguration.tsx`: wired `useTranslation('msp/contract-lines')`, translated preset basics card title with `{{name}} (Usage)`, `Contract Line Preset Basics` heading, preset-name label/placeholder, description copy, billing-frequency label/placeholder, and reset/save button labels with saving state.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/UsageContractLinePresetConfiguration.tsx` (warnings only, no errors).
- (2026-04-14) `F009` covered in `contract-lines/UsageContractLinePresetConfiguration.tsx`: translated service-pricing card title, accordion summaries (`Tiered Pricing`, `Not Set`, `Loading...`, rate/unit summary), loading configuration message, save-all CTA, manage preset services card title, and save/validation errors including `No changes detected to save` and `Cannot save, validation errors exist in the modified services`.
- (2026-04-14) `F010` implemented in `contract-lines/HourlyContractLinePresetConfiguration.tsx`: wired `useTranslation('msp/contract-lines')`, translated preset basics card title with `{{name}} (Hourly)`, basics section labels/placeholders/descriptions, minimum billable + round-up labels/help copy, and reset/save actions (including saving text).
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/HourlyContractLinePresetConfiguration.tsx` (warnings only, no errors).
- (2026-04-14) `F011` covered in `contract-lines/HourlyContractLinePresetConfiguration.tsx`: translated manage preset services card title plus all required error states (`Invalid plan type or plan not found`, `Contract line not found or invalid type`, `Failed to load plan configuration`) and shared save/validation error messages.
- (2026-04-14) `F012` implemented in `contract-lines/UsageContractLinePresetServicesList.tsx`: wired `useTranslation('msp/contract-lines')`; translated usage-preset services list headings/empty-state/loading text, metadata lines, action-menu screen-reader + remove action text, rate/unit labels, bucket switch label, and add-services section heading/copy.
- (2026-04-14) Billing method display labels in local `BILLING_METHOD_OPTIONS` now resolve through translation keys (`Fixed Price`, `Hourly`, `Usage Based`).
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/UsageContractLinePresetServicesList.tsx` (warnings only, no errors).
- (2026-04-14) `F013` covered in `contract-lines/UsageContractLinePresetServicesList.tsx`: translated add-service metadata/interpolation strings, `Add Selected ({{count}}) Services` CTA, bucket overlay defaults/labels, save/reset controls, unsaved-change banner + confirmation dialog labels/messages, success toast, and error fallbacks.
- (2026-04-14) `F014` implemented in `contract-lines/HourlyContractLinePresetServicesList.tsx`: wired `useTranslation('msp/contract-lines')`; translated hourly-preset services list heading/empty/loading copy, service metadata line, action-menu screen-reader + remove label, hourly rate label, bucket switch label, and add-services section heading/empty-state text.
- (2026-04-14) Local billing method labels (`Fixed Price`, `Hourly`, `Usage Based`) now flow through i18n keys in this component as well.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/HourlyContractLinePresetServicesList.tsx` (warnings only, no errors).
- (2026-04-14) `F015` covered in `contract-lines/HourlyContractLinePresetServicesList.tsx`: translated add-service metadata with interpolation, `Add Selected ({{count}}) Services` CTA, save/reset controls, unsaved-change banner + confirmation dialog text, success toast, and save error fallbacks.
- (2026-04-14) `F016` implemented in `contract-lines/GenericContractLineServicesList.tsx`: wired `useTranslation('msp/contract-lines')`; translated all primary table columns (service name/type, billing method, derived config type, quantity, unit, custom rate, actions), billing-method display labels, config badge text (`Billing mismatch`, `Default`), and action-menu screen-reader text.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/GenericContractLineServicesList.tsx` (warnings only, no errors).
- (2026-04-14) `F017` covered in `contract-lines/GenericContractLineServicesList.tsx`: translated add-services section heading, empty states (`No services currently associated...`, `All available services...`, `Loading services...`), service-detail interpolation text, custom-rate placeholder (`Enter rate`), `Add Selected ({{count}}) Services`, currency-mismatch copy (`No {{currency}} price`), and add/remove error messages.
- (2026-04-14) `F018` implemented in `ContractLines.tsx`: added `useTranslation('msp/contract-lines')`; translated contract-line table column headers (`Contract Line Name`, `Billing Frequency`, `Contract Line Type`, `Is Custom`, `Actions`), Yes/No display values, row action labels (`Edit`, `Delete`), menu screen-reader text, page heading, and `Add Contract Line` button text.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/ContractLines.tsx` (warnings only, no errors).
- (2026-04-14) `F019` covered in `ContractLines.tsx`: translated plan-services heading, `Services for {{name}}` subheading interpolation, empty state (`Select a contract line to manage its services`), plan-services table headers, service remove action label, service selector placeholder, `Add Service` button, and related add/update/remove/fetch error strings plus delete-success toast.
- (2026-04-14) `F020` implemented in `contract-lines/FixedContractLineConfiguration.tsx`: wired `useTranslation('msp/contract-lines')`; translated card title with `{{name}}`, contract-line basics section heading/description/labels/placeholders, billing-timing option labels + helper text, and cadence-owner section labels/descriptions with translated radio options.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx` (warnings only, no errors).
- (2026-04-14) `F021` covered in `contract-lines/FixedContractLineConfiguration.tsx`: translated fixed-fee settings heading/description, base-rate label/help, partial-period label/description, billing-cycle-alignment label/options/placeholder, associated-services card title, reset/save actions, and fixed-form validation/error messages.
- (2026-04-14) `F022` implemented in `contract-lines/FixedContractLinePresetConfiguration.tsx`: wired `useTranslation('msp/contract-lines')`; translated preset card title with `{{name}} (Fixed)`, `Contract Line Preset Basics` heading/description, name and billing-frequency labels/placeholders, plus billing-timing label/helper text in the preset settings area.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/FixedContractLinePresetConfiguration.tsx` (warnings only, no errors).
- (2026-04-14) `F023` covered in `contract-lines/FixedContractLinePresetConfiguration.tsx`: translated fixed-fee settings heading/description, `Recurring Base Rate (Optional)` and override helper text, proration label/description, added + translated billing-cycle-alignment selector with options (`Start of Billing Cycle`, `End of Billing Cycle`, `Proportional Coverage`), associated-services card title, reset/save actions, and preset validation/error messages.
- (2026-04-14) `F024` implemented in `contract-lines/ServiceHourlyConfigForm.tsx`: wired `useTranslation('msp/contract-lines')`; translated hourly-rate/minimum-billable/round-up labels, tooltip content, minute placeholders, and money placeholders while preserving existing validation rendering paths.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ServiceHourlyConfigForm.tsx` (warnings only, no errors).
- (2026-04-14) `F025` covered in `contract-lines/ServiceHourlyConfigForm.tsx`: translated user-type-specific-rates heading/tooltip, existing-rate display suffix, `Add New Rate` label, user-type select placeholder, `Add` button, user-type option labels (`Technician`, `Engineer`, `Consultant`, `Project Manager`, `Administrator`), and validation messages for missing/duplicate user type rate setup.
- (2026-04-14) `F026` implemented in `contract-lines/ContractLineServiceForm.tsx`: wired `useTranslation('msp/contract-lines')` and translated dialog title, loading state, and required error messages (`Missing plan or service information`, `Failed to load service configuration`, `Failed to update service`).
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ContractLineServiceForm.tsx` (warnings only, no errors).
- (2026-04-14) `F027` implemented in `contract-lines/ContractLinesOverview.tsx`: wired `useTranslation('msp/contract-lines')`; translated page heading, `Add Contract Line Preset` button, presets table column headers, action menu labels (`Edit`, `Delete`), and screen-reader `Open menu` text.
- (2026-04-14) Verification command run: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ContractLinesOverview.tsx` (warnings only, no errors).
- (2026-04-14) `F028` covered in `contract-lines/ContractLinesOverview.tsx`: translated filter/search placeholders, `All types` option, reset-filters button text, loading indicator text, delete-success toast, and delete/fetch error messages.
- (2026-04-13) **F029 complete** (`ServiceTierEditor.tsx`): added `useTranslation('msp/contract-lines')` and replaced all user-visible strings with `t()` defaults, including card title, Add Tier button, translated empty state, column headers with `{{unit}}` interpolation, helper text, `Unlimited` placeholder, and tier-indexed aria labels (`Tier {{tier}} ...`, `Remove Tier {{tier}}`).
- (2026-04-13) **F029 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ServiceTierEditor.tsx` (pass, no errors).
- (2026-04-13) **F030 complete** (`ServiceUsageConfigForm.tsx`): wired `useTranslation('msp/contract-lines')` and translated labels/tooltips/placeholders for default rate/unit/minimum usage, required field indicator, and tiered pricing switch with `{{serviceName}}` interpolation.
- (2026-04-13) **F030 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ServiceUsageConfigForm.tsx` (pass; pre-existing warnings only: `any` type and unused handler).
- (2026-04-13) **F031 complete** (`ServiceBucketConfigForm.tsx`): wired `useTranslation('msp/contract-lines')` and translated bucket labels/tooltips/placeholders with unit interpolation (`{{unit}}`/`{{units}}`), while preserving dynamic unit pluralization via `pluralizeUnit()` for runtime unit labels.
- (2026-04-13) **F031 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ServiceBucketConfigForm.tsx` (pass; pre-existing `any` warning only).
- (2026-04-13) **F032 complete** (`EditContractLineServiceQuantityDialog.tsx`): wired `useTranslation('msp/contract-lines')`; translated dialog title, quantity heading, quantity/unit-price labels, helper text, validation error (`Quantity must be greater than zero`), fallback update error, and Cancel/Save actions.
- (2026-04-13) **F032 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/EditContractLineServiceQuantityDialog.tsx` (pass; pre-existing `any` warning only).
- (2026-04-13) **F033 complete** (`ContractLineTypeSelector.tsx`): wired `useTranslation('msp/contract-lines')`; translated `Contract Line Type` label, dropdown placeholder, and fixed/hourly/usage description copy used in cards and dropdown option descriptions.
- (2026-04-13) **F033 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ContractLineTypeSelector.tsx` (pass, no errors).
- (2026-04-13) **F034 complete** (`ContractLineTypeRouter.tsx`): wired `useTranslation('msp/contract-lines')`; translated loading text, not-found message with `{{id}}`, load-failed error, and unsupported-type error with `{{type}}` interpolation.
- (2026-04-13) **F034 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ContractLineTypeRouter.tsx` (pass, no errors).
- (2026-04-13) **F035 complete** (`ContractLinePresetTypeRouter.tsx`): wired `useTranslation('msp/contract-lines')`; translated loading text, not-found message with `{{id}}`, load-failed error, and unsupported preset type message with `{{type}}` interpolation.
- (2026-04-13) **F035 verification**: `npx eslint packages/billing/src/components/billing-dashboard/contract-lines/ContractLinePresetTypeRouter.tsx` (pass, no errors).
- (2026-04-13) **F036 complete**: created `server/public/locales/en/msp/contract-lines.json` with 509 keys extracted from all `useTranslation('msp/contract-lines')` component calls (including static `t()` defaults plus `labelKey`/`descriptionKey` dynamic maps and type-selector description variants).
- (2026-04-13) **F036 verification runbook**:
  - Extraction/build script (AST-based, local one-off) to assemble key/default pairs from 21 contract-line components.
  - Coverage check script confirmed `missing 0` for static/dynamic key references against `en/msp/contract-lines.json`.
- (2026-04-13) **F037 complete**: generated production locale files for `msp/contract-lines`:
  - `server/public/locales/fr/msp/contract-lines.json`
  - `server/public/locales/es/msp/contract-lines.json`
  - `server/public/locales/de/msp/contract-lines.json`
  - `server/public/locales/nl/msp/contract-lines.json`
  - `server/public/locales/it/msp/contract-lines.json`
  - `server/public/locales/pl/msp/contract-lines.json`
- (2026-04-13) **F037 runbook**: used a local Node script to translate from `en/msp/contract-lines.json` via Google Translate endpoint with placeholder protection for `{{...}}` interpolation tokens and JSON structure preservation.
- (2026-04-13) **F037 verification**: key/shape/interpolation parity check against English returned, per locale, `missing: 0`, `extra: 0`, `phMismatch: 0`, `keys: 509`.
- (2026-04-13) **F038 complete**: added pseudo-locale namespace files:
  - `server/public/locales/xx/msp/contract-lines.json` (fill `1111`)
  - `server/public/locales/yy/msp/contract-lines.json` (fill `5555`)
- (2026-04-13) **F038 implementation note**: used the same leaf-string replacement semantics as `scripts/generate-pseudo-locale.ts`, preserving interpolation tokens (`{{...}}`) while replacing text payloads.
- (2026-04-13) **F039 complete**: ran `node scripts/validate-translations.cjs` after adding `msp/contract-lines` locale files.
- (2026-04-13) **F039 result**: `PASSED` with `Errors: 0` and `Warnings: 0` across production locales (`de/es/fr/it/nl/pl`) and pseudo-locales (`xx/yy`).
- (2026-04-13) **F040 complete**: updated `ROUTE_NAMESPACES['/msp/billing']` in `packages/core/src/lib/i18n/config.ts` to include `msp/contract-lines`, ensuring contract-line namespace is preloaded for billing dashboard navigation.
- (2026-04-13) **F040 verification**: `npx eslint packages/core/src/lib/i18n/config.ts` (pass, no errors).
- (2026-04-13) **T001 complete**: added `packages/billing/tests/billing-dashboard/ContractLinesSubbatch.i18n.test.ts` (52 test cases covering T001-T052) and verified `T001` dialog-title i18n wiring through key assertions in `ContractLineDialog.tsx`.
- (2026-04-13) **Test verification run**: `cd packages/billing && npx vitest run tests/billing-dashboard/ContractLinesSubbatch.i18n.test.ts` -> `52 passed`.
- (2026-04-13) **T002 complete**: covered by  and verified in the passing 52-test run.
- (2026-04-13) **T003 complete**: covered by  and verified in the passing 52-test run.
- (2026-04-13) **T004 complete**: covered by  and verified in the passing 52-test run.
- (2026-04-13) **T005 complete**: covered by  and verified in the passing 52-test run.
- (2026-04-13) **T006 complete**: covered by  and verified in the passing 52-test run.
