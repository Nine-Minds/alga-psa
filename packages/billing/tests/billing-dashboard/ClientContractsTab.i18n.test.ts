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

describe('ClientContractsTab i18n wiring contract', () => {
  it('T029: columns, status labels, and search controls use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ClientContractsTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'clientContracts.columns.client',
      'clientContracts.columns.sourceTemplate',
      'clientContracts.columns.contractName',
      'clientContracts.columns.startDate',
      'clientContracts.columns.endDate',
      'clientContracts.columns.billingFrequency',
      'clientContracts.columns.poIndicator',
      'clientContracts.columns.status',
      'clientContracts.columns.actions',
      'clientContracts.po.required',
      'clientContracts.po.notRequired',
      'status.active',
      'status.draft',
      'status.terminated',
      'status.expired',
      'clientContracts.search.placeholder',
      'clientContracts.search.ariaLabel',
      'clientContracts.tabs.contracts',
      'clientContracts.tabs.upcomingRenewals',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
