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

describe('ContractForm i18n wiring contract', () => {
  it('T037: heading, field labels, status options, validation copy, and save actions use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractForm.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractForm.heading',
      'contractForm.fields.contractName',
      'contractForm.fields.contractNamePlaceholder',
      'contractForm.fields.description',
      'contractForm.fields.descriptionPlaceholder',
      'contractForm.fields.billingFrequency',
      'contractForm.fields.billingFrequencyPlaceholder',
      'contractForm.fields.currency',
      'contractForm.fields.currencyPlaceholder',
      'contractForm.fields.status',
      'contractForm.status.active',
      'contractForm.status.draft',
      'contractForm.status.terminated',
      'contractForm.status.expired',
      'contractForm.status.expiredHelper',
      'contractForm.validation.requiredFields',
      'contractForm.validation.contractName',
      'contractForm.validation.billingFrequency',
      'contractForm.errors.failedToUpdateContract',
      'contractForm.actions.saving',
      'contractForm.actions.saveChanges',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
