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

describe('TemplateWizard i18n wiring contract', () => {
  it('T055: step labels and validation messages use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateWizard.title.createContractTemplate',
      'templateWizard.steps.templateBasics',
      'templateWizard.steps.fixedFeeBlocks',
      'templateWizard.steps.products',
      'templateWizard.steps.hourlyBlocks',
      'templateWizard.steps.usageBasedBlocks',
      'templateWizard.steps.reviewPublish',
      'templateWizard.actions.continue',
      'templateWizard.actions.publishTemplate',
      'templateWizard.validation.templateNameRequired',
      'templateWizard.validation.billingFrequencyRequired',
      'templateWizard.validation.duplicateNameExists',
      'templateWizard.validation.templateNameAlreadyInUse',
      'templateWizard.validation.atLeastOneServiceRequired',
      'templateWizard.validation.unsupportedRecurringAuthoringCombination',
      'templateWizard.errors.failedToCreateTemplate',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    expect(source).toContain('`templateWizard.validation.recurring.lineType.${RECURRING_LINE_TYPE_KEYS[unsupportedCombination.lineType]}`');
    expect(source).toContain('t(`templateWizard.validation.recurring.frequency.${value}`');
    expect(source).toContain('`templateWizard.validation.recurring.frequency.${unsupportedCombination.billingFrequency}`');
    expect(getLeaf(en, 'templateWizard.validation.recurring.lineType.fixed')).toBeDefined();
    expect(getLeaf(en, 'templateWizard.validation.recurring.lineType.product')).toBeDefined();
    expect(getLeaf(en, 'templateWizard.validation.recurring.lineType.hourly')).toBeDefined();
    expect(getLeaf(en, 'templateWizard.validation.recurring.lineType.usage')).toBeDefined();
    expect(getLeaf(en, 'templateWizard.validation.recurring.frequency.monthly')).toBeDefined();
    expect(getLeaf(en, 'templateWizard.validation.recurring.frequency.quarterly')).toBeDefined();
    expect(getLeaf(en, 'templateWizard.validation.recurring.frequency.annually')).toBeDefined();
  });
});
