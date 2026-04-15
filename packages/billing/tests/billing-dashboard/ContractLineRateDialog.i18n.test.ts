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

describe('Contract line/plan rate dialogs i18n wiring contract', () => {
  it('T044: title interpolation, rate label, validation copy, and action buttons use translated keys', () => {
    const lineSource = read('../../src/components/billing-dashboard/contracts/ContractLineRateDialog.tsx');
    const planSource = read('../../src/components/billing-dashboard/contracts/ContractPlanRateDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(lineSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(planSource).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractLineRate.title',
      'contractLineRate.fields.rate',
      'contractLineRate.validation.validRateRequired',
      'contractLineRate.actions.cancel',
      'contractLineRate.actions.saveRate',
    ];

    for (const key of keyChecks) {
      expect(lineSource).toContain(`t('${key}'`);
      expect(planSource).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    expect(lineSource).toContain('name: plan.contract_line_name');
    expect(planSource).toContain('name: contractLine.contract_line_name');
  });
});
