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

describe('ContractLineEditDialog i18n wiring contract', () => {
  it('T041: title interpolation, pricing/timing labels, options, and actions use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractLineEditDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractLineEdit.title',
      'contractLineEdit.values.unnamedLine',
      'contractLineEdit.sections.pricing',
      'contractLineEdit.fields.rate',
      'contractLineEdit.sections.billingTiming',
      'contractLineEdit.fields.billingTimingQuestion',
      'contractLineEdit.timingOptions.arrears',
      'contractLineEdit.timingOptions.advance',
      'contractLineEdit.timingDescriptions.arrears',
      'contractLineEdit.timingDescriptions.advance',
      'contractLineEdit.validation.validRateRequired',
      'contractLineEdit.errors.failedToSaveChanges',
      'contractLineEdit.actions.cancel',
      'contractLineEdit.actions.saveChanges',
      'contractLineEdit.actions.saving',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
