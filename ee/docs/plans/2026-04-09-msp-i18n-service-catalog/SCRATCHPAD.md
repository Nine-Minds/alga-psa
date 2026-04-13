# Scratchpad — MSP i18n: Service Catalog & Tax Rate Management

- Plan slug: `2026-04-09-msp-i18n-service-catalog`
- Created: `2026-04-09`

## Decisions

- (2026-04-09) **Single namespace**: All 14 files go into `msp/service-catalog` rather than splitting tax rates and service config into separate namespaces. The files are tightly coupled (service form references tax rates, config panels are composed together) and the total string count (~285-430) fits comfortably in one namespace.
- (2026-04-09) **Route mapping**: Service catalog components are rendered under `/msp/settings`, so `msp/service-catalog` is appended to the existing `/msp/settings` ROUTE_NAMESPACES entry rather than creating a new route.
- (2026-04-09) **Execution order**: Tax rates (TaxRates + TaxRateDetailPanel) first since they're self-contained, then ServiceForm, then the service-config panels (largest group), then the service-configurations orchestrator panels last.

## Discoveries / Constraints

### Two ServiceConfigurationPanel files
- (2026-04-09) There are two files with the same component name in different directories:
  - `service-configurations/ServiceConfigurationPanel.tsx` (279 LOC) — orchestrator that composes Base + type-specific panels, has save/cancel buttons and bucket overlay logic.
  - `service-config/ServiceConfigurationPanel.tsx` (135 LOC) — service detail page shell that composes ServiceTaxSettings + ServiceRateTiers + UnitOfMeasureInput.
  - Use distinct key prefixes: `serviceConfig.*` for the orchestrator, `serviceDetail.*` for the service-config shell.

### TaxRateDetailPanel sub-components
- (2026-04-09) `TaxRateDetailPanel.tsx` imports `TaxComponentEditor`, `TaxThresholdEditor`, and `TaxHolidayManager` from `../settings/tax/`. Those sub-components are **out of scope** for this batch since they live in the settings/tax directory, not the service catalog area. They likely warrant their own translation pass.

### ConfigurationTypeSelector descriptions
- (2026-04-09) `CONFIGURATION_TYPE_DESCRIPTIONS` and `CONFIGURATION_TYPE_OPTIONS` are module-level constants. After wiring `useTranslation`, these must move inside the component body (or be converted to functions that accept `t`) since `t()` requires the hook context.

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
