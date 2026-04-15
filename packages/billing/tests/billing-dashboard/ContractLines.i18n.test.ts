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

describe('ContractLines i18n wiring contract', () => {
  it('T020: section header, add/create controls, summary labels, and empty states use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractLines.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractLines.title',
      'contractLines.description.default',
      'contractLines.description.readOnly',
      'contractLines.actions.addFromPresets',
      'contractLines.actions.createCustom',
      'contractLines.actions.expandLine',
      'contractLines.actions.collapseLine',
      'contractLines.columns.name',
      'contractLines.columns.type',
      'contractLines.columns.frequency',
      'contractLines.columns.rate',
      'contractLines.columns.services',
      'contractLines.columns.actions',
      'contractLines.serviceCountSingle',
      'contractLines.serviceCountPlural',
      'contractLines.customRate',
      'contractLines.empty.noneAdded',
      'contractLines.empty.selectAbove',
      'contractLines.loading.contractLines',
      'common.actions.edit',
      'common.actions.remove',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
