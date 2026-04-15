// @vitest-environment node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function flattenLeafKeys(record: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenLeafKeys(value as Record<string, unknown>, next));
    } else {
      keys.push(next);
    }
  }
  return keys;
}

function expectSourceHasKeys(source: string, keys: string[]): void {
  for (const key of keys) {
    const single = `t('${key}'`;
    const double = `t("${key}"`;
    expect(source.includes(single) || source.includes(double)).toBe(true);
  }
}

function expectLocaleHasKeys(locale: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    expect(getLeaf(locale, key)).toBeDefined();
  }
}

const EN = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/en/msp/contract-lines.json'
);
const XX = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/xx/msp/contract-lines.json'
);
const YY = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/yy/msp/contract-lines.json'
);
const FR = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/fr/msp/contract-lines.json'
);
const ES = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/es/msp/contract-lines.json'
);
const DE = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/de/msp/contract-lines.json'
);
const NL = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/nl/msp/contract-lines.json'
);
const IT = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/it/msp/contract-lines.json'
);
const PL = readJson<Record<string, unknown>>(
  '../../../../server/public/locales/pl/msp/contract-lines.json'
);

describe('MSP contract-lines sub-batch i18n wiring contract', () => {
  it('T001: ContractLineDialog title renders translated text for add and edit modes', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, ['dialog.title.add', 'dialog.title.edit']);
  });

  it('T002: ContractLineDialog preset basics labels and validation prefix are translated', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, [
      'dialog.basics.nameLabel',
      'dialog.basics.billingFrequencyLabel',
      'dialog.basics.billingTimingLabel',
      'dialog.validation.prefix',
    ]);
  });

  it('T003: ContractLineDialog billing model selector cards use translated titles/descriptions', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, [
      'dialog.billingModel.cards.fixed.title',
      'dialog.billingModel.cards.fixed.description',
      'dialog.billingModel.cards.hourly.title',
      'dialog.billingModel.cards.hourly.description',
      'dialog.billingModel.cards.usage.title',
      'dialog.billingModel.cards.usage.description',
    ]);
  });

  it('T004: ContractLineDialog billing timing helper uses translated fixed/non-fixed variants', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, ['dialog.billingModel.timingHelp.fixed', 'dialog.billingModel.timingHelp.nonFixed']);
  });

  it('T005: ContractLineDialog fixed section uses translated labels and controls', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, [
      'dialog.fixed.alertTitle',
      'dialog.fixed.servicesAndProducts',
      'dialog.fixed.addItem',
      'dialog.fixed.emptyState',
      'dialog.fixed.baseRateLabel',
      'dialog.fixed.adjustForPartialPeriodsLabel',
    ]);
  });

  it('T006: ContractLineDialog hourly section uses translated labels and controls', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, [
      'dialog.hourly.alertTitle',
      'dialog.hourly.minimumBillableTimeLabel',
      'dialog.hourly.servicesHeading',
      'dialog.hourly.hourlyRateLabel',
      'dialog.hourly.recommendBucketLabel',
      'dialog.hourly.addHourlyService',
    ]);
  });

  it('T007: ContractLineDialog usage section uses translated labels and controls', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, [
      'dialog.usage.alertTitle',
      'dialog.usage.servicesHeading',
      'dialog.usage.ratePerUnitLabel',
      'dialog.usage.unitOfMeasureLabel',
      'dialog.usage.addUsageService',
    ]);
  });

  it('T008: ContractLineDialog validation messages are translated with interpolation support', () => {
    const source = read('../../src/components/billing-dashboard/ContractLineDialog.tsx');
    expectSourceHasKeys(source, ['dialog.validation.serviceSelectRequired', 'dialog.validation.unitRateRequired']);
    expect(getLeaf(EN, 'dialog.validation.serviceSelectRequired')).toBe('Service {{index}}: Please select a service');
  });

  it('T009: HourlyContractLineConfiguration basics card title includes interpolated plan name and hourly suffix', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLineConfiguration.tsx');
    expectSourceHasKeys(source, ['configuration.hourly.basics.cardTitle', 'configuration.hourly.basics.heading', 'configuration.hourly.basics.description']);
    expect(getLeaf(EN, 'configuration.hourly.basics.cardTitle')).toBe('Edit Contract Line: {{name}} (Hourly)');
  });

  it('T010: HourlyContractLineConfiguration plan-wide overtime settings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLineConfiguration.tsx');
    expectSourceHasKeys(source, [
      'configuration.hourly.planWideSettings.trigger',
      'configuration.hourly.planWideSettings.overtime.enableLabel',
      'configuration.hourly.planWideSettings.overtime.tooltip',
      'configuration.hourly.planWideSettings.overtime.rateLabel',
      'configuration.hourly.planWideSettings.overtime.thresholdLabel',
    ]);
  });

  it('T011: HourlyContractLineConfiguration after-hours settings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLineConfiguration.tsx');
    expectSourceHasKeys(source, [
      'configuration.hourly.planWideSettings.afterHours.enableLabel',
      'configuration.hourly.planWideSettings.afterHours.tooltip',
      'configuration.hourly.planWideSettings.afterHours.multiplierLabel',
      'configuration.hourly.planWideSettings.afterHours.multiplierHelp',
    ]);
  });

  it('T012: HourlyContractLineConfiguration service rates section text is translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLineConfiguration.tsx');
    expectSourceHasKeys(source, [
      'configuration.hourly.services.cardTitle',
      'configuration.hourly.services.emptyState',
      'configuration.hourly.services.nonHourlyServiceMessage',
      'configuration.hourly.actions.saveConfiguration',
    ]);
  });

  it('T013: UsageContractLineConfiguration basics section is translated with usage card title interpolation', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLineConfiguration.tsx');
    expectSourceHasKeys(source, ['configuration.usage.basics.cardTitle', 'configuration.usage.basics.heading', 'configuration.usage.basics.description']);
    expect(getLeaf(EN, 'configuration.usage.basics.cardTitle')).toBe('Edit Contract Line: {{name}} (Usage)');
  });

  it('T014: UsageContractLineConfiguration service summary text is translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLineConfiguration.tsx');
    expectSourceHasKeys(source, [
      'configuration.usage.services.summary.tieredPricing',
      'configuration.usage.services.summary.ratePerUnit',
      'configuration.usage.services.summary.notSet',
    ]);
  });

  it('T015: UsageContractLineConfiguration save-all action and empty state are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLineConfiguration.tsx');
    expectSourceHasKeys(source, ['configuration.usage.actions.saveAllConfigurations', 'configuration.usage.services.emptyStateWithHelper']);
  });

  it('T016: UsageContractLinePresetConfiguration uses Contract Line Preset terminology in basics keys', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLinePresetConfiguration.tsx');
    expectSourceHasKeys(source, ['preset.usage.basics.heading', 'preset.usage.basics.nameLabel']);
    expect(getLeaf(EN, 'preset.usage.basics.heading')).toBe('Contract Line Preset Basics');
  });

  it('T017: UsageContractLinePresetConfiguration translated save/validation error messages exist', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLinePresetConfiguration.tsx');
    expectSourceHasKeys(source, ['preset.usage.errors.noChangesDetected', 'preset.usage.errors.validationErrorsInModifiedServices']);
  });

  it('T018: HourlyContractLinePresetConfiguration basics section fields are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLinePresetConfiguration.tsx');
    expectSourceHasKeys(source, [
      'preset.hourly.basics.nameLabel',
      'preset.hourly.basics.minimumBillableTimeLabel',
      'preset.hourly.basics.roundUpToNearestLabel',
      'preset.hourly.basics.minimumBillableTimeHelp',
      'preset.hourly.basics.roundUpToNearestHelp',
    ]);
  });

  it('T019: HourlyContractLinePresetConfiguration error state strings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLinePresetConfiguration.tsx');
    expectSourceHasKeys(source, [
      'preset.hourly.errors.contractLineNotFoundOrInvalidType',
      'preset.hourly.errors.invalidPlanTypeOrNotFound',
      'preset.hourly.errors.failedToLoadPlanConfiguration',
    ]);
  });

  it('T020: UsageContractLinePresetServicesList translated headers/actions wiring exists', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLinePresetServicesList.tsx');
    expectSourceHasKeys(source, [
      'services.usagePreset.serviceMetadata',
      'services.usagePreset.ratePerUnitLabel',
      'services.usagePreset.unitLabel',
      'common.actions.remove',
    ]);
  });

  it('T021: UsageContractLinePresetServicesList add-service metadata interpolation is translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/UsageContractLinePresetServicesList.tsx');
    expectSourceHasKeys(source, ['services.usagePreset.serviceToAddMetadata', 'services.usagePreset.addSelectedServices']);
    expect(getLeaf(EN, 'services.usagePreset.serviceToAddMetadata')).toBe('Service Type: {{type}} | Method: {{method}} | Default Rate: {{rate}} | Unit: {{unit}}');
  });

  it('T022: HourlyContractLinePresetServicesList translated headers/actions wiring exists', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLinePresetServicesList.tsx');
    expectSourceHasKeys(source, ['services.hourlyPreset.serviceMetadata', 'services.hourlyPreset.hourlyRateLabel', 'common.actions.remove']);
  });

  it('T023: HourlyContractLinePresetServicesList unsaved-change dialog and toast strings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/HourlyContractLinePresetServicesList.tsx');
    expectSourceHasKeys(source, [
      'services.hourlyPreset.unsavedChanges.dialogTitle',
      'services.hourlyPreset.unsavedChanges.dialogMessage',
      'services.hourlyPreset.toast.savedSuccessfully',
    ]);
  });

  it('T024: GenericContractLineServicesList table column headers are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/GenericContractLineServicesList.tsx');
    expectSourceHasKeys(source, [
      'services.generic.columns.serviceName',
      'services.generic.columns.serviceType',
      'services.generic.columns.billingMethod',
      'services.generic.columns.derivedConfigType',
      'services.generic.columns.quantity',
      'services.generic.columns.unitOfMeasure',
      'services.generic.columns.customRate',
      'services.generic.columns.actions',
    ]);
  });

  it('T025: GenericContractLineServicesList billing-method labels and config badge text are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/GenericContractLineServicesList.tsx');
    expect(source).toContain('t(billingMethodOption.labelKey');
    expectSourceHasKeys(source, ['services.generic.badges.defaultConfigType']);
    expectLocaleHasKeys(EN, [
      'services.generic.billingMethod.fixed',
      'services.generic.billingMethod.hourly',
      'services.generic.billingMethod.usage',
    ]);
  });

  it('T026: GenericContractLineServicesList add-services section strings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/GenericContractLineServicesList.tsx');
    expectSourceHasKeys(source, [
      'services.generic.addServicesHeading',
      'services.generic.emptyState',
      'services.generic.allServicesAssociated',
      'services.generic.serviceToAdd.metadata',
      'services.generic.addSelectedServices',
    ]);
  });

  it('T027: ContractLines heading/table/actions are translated', () => {
    const source = read('../../src/components/billing-dashboard/ContractLines.tsx');
    expectSourceHasKeys(source, [
      'list.heading',
      'list.columns.contractLineName',
      'list.columns.billingFrequency',
      'list.columns.contractLineType',
      'list.columns.isCustom',
      'common.actions.edit',
      'common.actions.delete',
    ]);
  });

  it('T028: ContractLines plan services section and interpolation keys are translated', () => {
    const source = read('../../src/components/billing-dashboard/ContractLines.tsx');
    expectSourceHasKeys(source, [
      'list.planServices.heading',
      'list.planServices.servicesFor',
      'list.planServices.emptyStateSelectContractLine',
      'list.planServices.columns.serviceName',
      'list.planServices.columns.quantity',
      'list.planServices.columns.unitOfMeasure',
      'list.planServices.columns.customRate',
      'list.planServices.actions.addService',
    ]);
    expect(getLeaf(EN, 'list.planServices.servicesFor')).toBe('Services for {{name}}');
  });

  it('T029: FixedContractLineConfiguration basics/cadence owner labels are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx');
    expectSourceHasKeys(source, [
      'configuration.fixed.basics.heading',
      'configuration.fixed.basics.description',
      'configuration.fixed.basics.nameLabel',
      'configuration.fixed.basics.billingFrequencyLabel',
      'configuration.fixed.basics.billingTimingLabel',
      'configuration.fixed.basics.cadenceOwner.label',
    ]);
    expectLocaleHasKeys(EN, [
      'configuration.fixed.basics.cadenceOwner.options.client.label',
      'configuration.fixed.basics.cadenceOwner.options.client.description',
      'configuration.fixed.basics.cadenceOwner.options.contract.label',
      'configuration.fixed.basics.cadenceOwner.options.contract.description',
    ]);
  });

  it('T030: FixedContractLineConfiguration fixed-fee settings keys are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/FixedContractLineConfiguration.tsx');
    expectSourceHasKeys(source, [
      'configuration.fixed.settings.heading',
      'configuration.fixed.settings.baseRateLabel',
      'configuration.fixed.settings.adjustForPartialPeriodsLabel',
      'configuration.fixed.settings.adjustForPartialPeriodsHelp',
      'configuration.fixed.settings.billingCycleAlignment.options.start',
      'configuration.fixed.settings.billingCycleAlignment.options.end',
      'configuration.fixed.settings.billingCycleAlignment.options.prorated',
    ]);
  });

  it('T031: FixedContractLinePresetConfiguration basics uses Contract Line Preset terminology', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/FixedContractLinePresetConfiguration.tsx');
    expectSourceHasKeys(source, ['preset.fixed.basics.heading', 'preset.fixed.basics.nameLabel']);
    expect(getLeaf(EN, 'preset.fixed.basics.heading')).toBe('Contract Line Preset Basics');
  });

  it('T032: FixedContractLinePresetConfiguration translated settings include optional base-rate and billing timing help', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/FixedContractLinePresetConfiguration.tsx');
    expectSourceHasKeys(source, [
      'preset.fixed.settings.baseRateLabel',
      'preset.fixed.settings.baseRateHelp',
      'preset.fixed.settings.billingTimingLabel',
      'preset.fixed.settings.billingTimingHelp',
    ]);
  });

  it('T033: ServiceHourlyConfigForm base labels/tooltips are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceHourlyConfigForm.tsx');
    expectSourceHasKeys(source, [
      'forms.hourlyConfig.labels.hourlyRate',
      'forms.hourlyConfig.labels.minimumBillableTime',
      'forms.hourlyConfig.labels.roundUpToNearest',
      'forms.hourlyConfig.tooltips.hourlyRate',
      'forms.hourlyConfig.tooltips.minimumBillableTime',
      'forms.hourlyConfig.tooltips.roundUpToNearest',
    ]);
  });

  it('T034: ServiceHourlyConfigForm user-type-rates section strings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceHourlyConfigForm.tsx');
    expectSourceHasKeys(source, [
      'forms.hourlyConfig.userTypeRates.heading',
      'forms.hourlyConfig.userTypeRates.tooltip',
      'forms.hourlyConfig.userTypeRates.addNewRateLabel',
      'common.actions.add',
    ]);
  });

  it('T035: ServiceHourlyConfigForm user-type option labels and validation errors are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceHourlyConfigForm.tsx');
    expectSourceHasKeys(source, [
      'forms.hourlyConfig.userTypeRates.options.technician',
      'forms.hourlyConfig.userTypeRates.options.engineer',
      'forms.hourlyConfig.userTypeRates.options.consultant',
      'forms.hourlyConfig.userTypeRates.options.projectManager',
      'forms.hourlyConfig.userTypeRates.options.administrator',
      'forms.hourlyConfig.userTypeRates.validation.selectTypeAndRate',
      'forms.hourlyConfig.userTypeRates.validation.duplicateType',
    ]);
  });

  it('T036: ContractLineServiceForm title/loading/errors are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ContractLineServiceForm.tsx');
    expectSourceHasKeys(source, [
      'forms.serviceForm.title',
      'forms.serviceForm.loading',
      'forms.serviceForm.errors.missingPlanOrServiceInformation',
      'forms.serviceForm.errors.failedToLoadServiceConfiguration',
      'forms.serviceForm.errors.failedToUpdateService',
    ]);
  });

  it('T037: ContractLinesOverview heading/button/columns are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ContractLinesOverview.tsx');
    expectSourceHasKeys(source, [
      'overview.heading',
      'overview.actions.addContractLinePreset',
      'overview.columns.contractLineName',
      'overview.columns.billingFrequency',
      'overview.columns.contractLineType',
      'overview.columns.actions',
      'common.actions.openMenu',
    ]);
  });

  it('T038: ContractLinesOverview filters/loading/toast/errors are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ContractLinesOverview.tsx');
    expectSourceHasKeys(source, [
      'overview.filters.searchPlaceholder',
      'overview.filters.type.allTypes',
      'common.actions.reset',
      'overview.loading',
      'overview.toast.contractLinePresetDeletedSuccessfully',
      'overview.errors.failedToFetchContractLinePresets',
    ]);
  });

  it('T039: ServiceTierEditor labels/headers/aria/helper text are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceTierEditor.tsx');
    expectSourceHasKeys(source, [
      'forms.tierEditor.cardTitle',
      'forms.tierEditor.actions.addTier',
      'forms.tierEditor.columns.from',
      'forms.tierEditor.columns.to',
      'forms.tierEditor.columns.ratePerUnit',
      'forms.tierEditor.emptyState',
      'forms.tierEditor.helperText',
      'forms.tierEditor.aria.fromAmount',
      'forms.tierEditor.aria.toAmount',
      'forms.tierEditor.aria.rate',
      'forms.tierEditor.aria.removeTier',
    ]);
  });

  it('T040: ServiceTierEditor unlimited placeholder is translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceTierEditor.tsx');
    expectSourceHasKeys(source, ['forms.tierEditor.unlimitedPlaceholder']);
  });

  it('T041: ServiceUsageConfigForm labels/tooltips/required hint/switch interpolation are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceUsageConfigForm.tsx');
    expectSourceHasKeys(source, [
      'forms.usageConfig.labels.defaultRatePerUnit',
      'forms.usageConfig.labels.unitOfMeasure',
      'forms.usageConfig.labels.minimumUsage',
      'forms.usageConfig.tooltips.defaultRatePerUnit',
      'forms.usageConfig.tooltips.unitOfMeasure',
      'forms.usageConfig.tooltips.minimumUsage',
      'forms.usageConfig.requiredFieldHint',
      'forms.usageConfig.labels.enableTieredPricing',
    ]);
    expect(getLeaf(EN, 'forms.usageConfig.labels.enableTieredPricing')).toBe('Enable Tiered Pricing for {{serviceName}}');
  });

  it('T042: ServiceBucketConfigForm labels/tooltips/rollover text are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceBucketConfigForm.tsx');
    expectSourceHasKeys(source, [
      'forms.bucketConfig.labels.totalInBucket',
      'forms.bucketConfig.labels.overageRatePerUnit',
      'forms.bucketConfig.labels.allowRollover',
      'forms.bucketConfig.tooltips.totalInBucket',
      'forms.bucketConfig.tooltips.overageRatePerUnit',
      'forms.bucketConfig.tooltips.allowRollover',
    ]);
  });

  it('T043: ServiceBucketConfigForm dynamic pluralization logic is retained with translated labels', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ServiceBucketConfigForm.tsx');
    expect(source).toContain('const pluralizeUnit =');
    expect(source).toContain("t('forms.bucketConfig.labels.totalInBucket'");
    expect(source).toContain("t('forms.bucketConfig.labels.allowRollover'");
  });

  it('T044: EditContractLineServiceQuantityDialog strings are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/EditContractLineServiceQuantityDialog.tsx');
    expectSourceHasKeys(source, [
      'forms.editQuantity.dialogTitle',
      'forms.editQuantity.heading',
      'forms.editQuantity.labels.quantity',
      'forms.editQuantity.labels.unitPriceOverrideOptional',
      'forms.editQuantity.helperText',
      'forms.editQuantity.errors.quantityGreaterThanZero',
      'forms.editQuantity.errors.updateFailed',
      'common.actions.cancel',
      'common.actions.save',
    ]);
  });

  it('T045: ContractLineTypeSelector label/descriptions/placeholder are translated', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ContractLineTypeSelector.tsx');
    expect(source).toContain('typeSelector.descriptions.${planType.toLowerCase()}');
    expectSourceHasKeys(source, ['typeSelector.label', 'typeSelector.placeholder']);
    expectLocaleHasKeys(EN, [
      'typeSelector.descriptions.fixed',
      'typeSelector.descriptions.hourly',
      'typeSelector.descriptions.usage',
    ]);
  });

  it('T046: ContractLineTypeRouter loading/errors are translated with interpolated id/type values', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ContractLineTypeRouter.tsx');
    expectSourceHasKeys(source, [
      'router.contractLine.loading',
      'router.contractLine.notFound',
      'router.contractLine.loadFailed',
      'router.contractLine.unsupportedType',
    ]);
    expect(getLeaf(EN, 'router.contractLine.notFound')).toBe('Contract line with ID {{id}} not found.');
    expect(getLeaf(EN, 'router.contractLine.unsupportedType')).toBe('Unknown or unsupported contract line type: {{type}}');
  });

  it('T047: ContractLinePresetTypeRouter loading/errors are translated with interpolated id/type values', () => {
    const source = read('../../src/components/billing-dashboard/contract-lines/ContractLinePresetTypeRouter.tsx');
    expectSourceHasKeys(source, [
      'router.preset.loading',
      'router.preset.notFound',
      'router.preset.loadFailed',
      'router.preset.unsupportedType',
    ]);
    expect(getLeaf(EN, 'router.preset.notFound')).toBe('Contract line preset with ID {{id}} not found.');
    expect(getLeaf(EN, 'router.preset.unsupportedType')).toBe('Unknown or unsupported contract line preset type: {{type}}');
  });

  it('T048: english namespace exists with organized keys and expected baseline strings', () => {
    const allKeys = flattenLeafKeys(EN);
    expect(allKeys.length).toBeGreaterThan(400);
    expect(getLeaf(EN, 'dialog.title.add')).toBe('Add Contract Line Preset');
    expect(getLeaf(EN, 'overview.heading')).toBe('Contract Line Presets');
    expect(getLeaf(EN, 'forms.tierEditor.cardTitle')).toBe('Pricing Tiers');
  });

  it('T049: production locale files contain every key from english namespace', () => {
    const enKeys = flattenLeafKeys(EN).sort();
    for (const locale of [FR, ES, DE, NL, IT, PL]) {
      const localeKeys = flattenLeafKeys(locale).sort();
      expect(localeKeys).toEqual(enKeys);
    }
  });

  it('T050: pseudo-locale files exist and cover all english keys', () => {
    const enKeys = flattenLeafKeys(EN).sort();
    expect(flattenLeafKeys(XX).sort()).toEqual(enKeys);
    expect(flattenLeafKeys(YY).sort()).toEqual(enKeys);
  });

  it('T051: validate-translations passes for contract-lines namespace across locales', () => {
    const output = execSync('node scripts/validate-translations.cjs', {
      cwd: path.resolve(__dirname, '../../../../'),
      encoding: 'utf8',
    });
    expect(output).toContain('PASSED');
    expect(output).toContain('Errors: 0');
  });

  it('T052: ROUTE_NAMESPACES includes msp/contract-lines on billing route', () => {
    const configSource = read('../../../core/src/lib/i18n/config.ts');
    // Match the /msp/billing entry and assert msp/contract-lines is in its list.
    // Loose match so follow-on batches (msp/contracts, etc.) can extend the route without breaking this test.
    const match = configSource.match(/'\/msp\/billing'\s*:\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("'msp/contract-lines'");
  });
});
