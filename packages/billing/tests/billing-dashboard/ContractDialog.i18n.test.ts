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

describe('ContractDialog i18n wiring contract', () => {
  it('T010: title, primary form labels, and validation errors use msp/contracts translation keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractDialog.title.create',
      'contractDialog.title.edit',
      'contractDialog.form.clientLabel',
      'contractDialog.form.contractNameLabel',
      'contractDialog.form.billingFrequencyLabel',
      'contractDialog.form.currencyHint',
      'contractDialog.form.startDateLabel',
      'contractDialog.form.endDateLabel',
      'contractDialog.form.descriptionLabel',
      'contractDialog.form.renewalSettingsTitle',
      'contractDialog.form.renewalSettingsDescription',
      'contractDialog.form.useTenantDefaultsLabel',
      'contractDialog.form.noticePeriodLabel',
      'contractDialog.form.renewalTermLabel',
      'contractDialog.validation.requiredFields',
      'contractDialog.validation.client',
      'contractDialog.validation.contractName',
      'contractDialog.validation.billingFrequency',
      'contractDialog.validation.startDate',
      'contractDialog.validation.poNumberRequired',
      'contractDialog.validation.noticePeriodInvalid',
      'contractDialog.validation.renewalTermInvalid',
      'contractDialog.validation.failedToSave',
      'renewal.labels.mode',
      'renewal.modes.manual',
      'renewal.modes.auto',
      'renewal.modes.none',
      'common.actions.cancel',
      'contractDialog.actions.updateContract',
      'contractDialog.actions.createContract',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
