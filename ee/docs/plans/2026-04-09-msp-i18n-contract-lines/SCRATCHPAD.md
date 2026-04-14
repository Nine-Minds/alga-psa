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
