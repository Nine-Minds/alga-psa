// @vitest-environment node

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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('ContractWizard i18n wiring contract', () => {
  it('T031: wizard step labels are translated via msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractWizard.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizard.steps.contractBasics',
      'wizard.steps.fixedFeeServices',
      'wizard.steps.products',
      'wizard.steps.hourlyServices',
      'wizard.steps.usageBasedServices',
      'wizard.steps.reviewCreate',
      'wizard.title.createNewContract',
      'wizard.title.editContract',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T032: validation, recurring-authoring errors, and draft/save failure copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractWizard.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'wizard.validation.clientRequired',
      'wizard.validation.contractNameRequired',
      'wizard.validation.billingFrequencyRequired',
      'wizard.validation.startDateRequired',
      'wizard.validation.renewalModeRequiredWithEndDate',
      'wizard.validation.noticePeriodWholeNumber',
      'wizard.validation.noticePeriodRange',
      'wizard.validation.renewalTermPositiveWhole',
      'wizard.validation.baseRateRequiredWhenFixedServices',
      'wizard.validation.selectProductForEachLine',
      'wizard.validation.addAtLeastOneService',
      'wizard.validation.selectClientBeforeDraft',
      'wizard.validation.unsupportedRecurringAuthoringCombination',
      'wizard.errors.failedToLoadTemplates',
      'wizard.errors.failedToLoadTemplateDetails',
      'wizard.errors.failedToCreateContract',
      'wizard.errors.failedToSaveDraft',
      'wizard.dialogs.unsavedChanges.title',
      'wizard.dialogs.unsavedChanges.message',
      'wizard.dialogs.unsavedChanges.confirm',
      'wizard.dialogs.unsavedChanges.cancel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    expect(source).toContain('t(`wizard.validation.recurring.frequency.${value}`');
    expect(source).toContain('`wizard.validation.recurring.lineType.${RECURRING_LINE_TYPE_KEYS[unsupportedCombination.lineType]}`');
    expect(source).toContain('`wizard.validation.recurring.frequency.${unsupportedCombination.billingFrequency}`');

    const recurringLocaleKeys = [
      'wizard.validation.recurring.frequency.monthly',
      'wizard.validation.recurring.frequency.quarterly',
      'wizard.validation.recurring.frequency.annually',
      'wizard.validation.recurring.lineType.fixed',
      'wizard.validation.recurring.lineType.product',
      'wizard.validation.recurring.lineType.hourly',
      'wizard.validation.recurring.lineType.usage',
    ];

    for (const key of recurringLocaleKeys) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
