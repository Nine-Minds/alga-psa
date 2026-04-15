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

describe('ContractHeader i18n wiring contract', () => {
  it('T042: stat labels, status badges, template/client-owned badges, and PO alert use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractHeader.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractHeader.labels.billingFrequency',
      'contractHeader.labels.currency',
      'contractHeader.labels.contractLines',
      'contractHeader.labels.startDate',
      'contractHeader.labels.endDate',
      'contractHeader.labels.lastUpdated',
      'contractHeader.values.ongoing',
      'contractHeader.status.active',
      'contractHeader.status.draft',
      'contractHeader.status.terminated',
      'contractHeader.status.expired',
      'contractHeader.badges.template',
      'contractHeader.badges.clientOwned',
      'contractHeader.po.requiredForContract',
      'contractHeader.po.prefix',
      'common.notAvailable',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
