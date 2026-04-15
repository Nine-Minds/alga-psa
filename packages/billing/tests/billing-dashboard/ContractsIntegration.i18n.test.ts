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

function getTranslationKeys(source: string): string[] {
  return Array.from(new Set(Array.from(source.matchAll(/(?:^|[^\w])t\('([^']+)'/g), (match) => match[1])));
}

describe('Contracts integration i18n coverage', () => {
  it('T063: /msp/billing contracts tab wiring resolves sub-tab/list translations via msp/contracts in en', () => {
    const configSource = read('../../../../packages/core/src/lib/i18n/config.ts');
    const contractsSource = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const clientContractsSource = read('../../src/components/billing-dashboard/contracts/ClientContractsTab.tsx');
    const templatesSource = read('../../src/components/billing-dashboard/contracts/TemplatesTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(configSource).toContain("'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports', 'msp/billing', 'msp/contract-lines', 'msp/contracts']");

    expect(contractsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(clientContractsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templatesSource).toContain("const { t } = useTranslation('msp/contracts');");

    expect(contractsSource).toContain("t('common.tabs.templates'");
    expect(contractsSource).toContain("t('common.tabs.clientContracts'");
    expect(contractsSource).toContain("t('common.tabs.drafts'");
    expect(contractsSource).not.toContain('CONTRACT_SUBTAB_LABELS');

    const keySet = new Set<string>([
      ...getTranslationKeys(contractsSource),
      ...getTranslationKeys(clientContractsSource),
      ...getTranslationKeys(templatesSource),
    ]);

    expect(keySet.size).toBeGreaterThan(80);

    for (const key of keySet) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T064: /msp/billing contracts view resolves de locale sub-tab labels, column headers, and action-menu keys', () => {
    const contractsSource = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );
    const de = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/de/msp/contracts.json'
    );

    const localeKeys = [
      'common.tabs.templates',
      'common.tabs.clientContracts',
      'common.tabs.drafts',
      'contractsList.columns.contractName',
      'contractsList.columns.client',
      'contractsList.columns.status',
      'contractsList.columns.startDate',
      'contractsList.columns.endDate',
      'contractsList.actions.openMenu',
      'contractsList.actions.resume',
      'contractsList.actions.terminate',
      'contractsList.actions.restore',
      'contractsList.actions.createContract',
      'contractsList.actions.createTemplate',
    ];

    for (const key of localeKeys) {
      expect(getLeaf(en, key)).toBeDefined();
      expect(getLeaf(de, key)).toBeDefined();
    }

    expect(getLeaf(de, 'common.tabs.templates')).not.toBe(getLeaf(en, 'common.tabs.templates'));
    expect(getLeaf(de, 'common.tabs.clientContracts')).not.toBe(
      getLeaf(en, 'common.tabs.clientContracts')
    );
    expect(getLeaf(de, 'common.tabs.drafts')).not.toBe(getLeaf(en, 'common.tabs.drafts'));

    const requiredSourceKeys = [
      'common.tabs.templates',
      'common.tabs.clientContracts',
      'common.tabs.drafts',
      'contractsList.columns.contractName',
      'contractsList.columns.client',
      'contractsList.columns.status',
      'contractsList.columns.startDate',
      'contractsList.columns.endDate',
      'contractsList.actions.openMenu',
      'contractsList.actions.resume',
      'contractsList.actions.terminate',
      'contractsList.actions.restore',
    ];

    for (const key of requiredSourceKeys) {
      expect(contractsSource).toContain(`t('${key}'`);
    }
  });
});
