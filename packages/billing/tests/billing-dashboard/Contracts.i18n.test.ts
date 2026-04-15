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

describe('Contracts list i18n wiring contract', () => {
  it('T025: sub-tab labels, create actions, and search placeholders use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'common.tabs.templates',
      'common.tabs.clientContracts',
      'common.tabs.drafts',
      'contractsList.actions.createTemplate',
      'contractsList.actions.createContract',
      'contractsList.actions.quickAdd',
      'contractsList.search.templatesPlaceholder',
      'contractsList.search.templatesAriaLabel',
      'contractsList.search.clientContractsPlaceholder',
      'contractsList.search.clientContractsAriaLabel',
      'contractsList.search.draftsPlaceholder',
      'contractsList.search.draftsAriaLabel',
      'contractsList.drafts.badgeCount',
      'contractsList.heading.title',
      'contractsList.heading.description',
      'contractsList.loading.contracts',
      'contractsList.errors.failedToFetch',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
