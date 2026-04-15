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

describe('ContractTemplateDetail i18n wiring contract', () => {
  it('T013: page header, back actions, and key section labels use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractTemplateDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateDetail.loadingTemplate',
      'templateDetail.templateNotFound',
      'templateDetail.failedToLoadTemplate',
      'templateDetail.backToTemplatesArrow',
      'templateDetail.backToTemplates',
      'templateDetail.templateBadge',
      'templateDetail.templateSnapshotTitle',
      'contractDetail.tabs.lines',
      'templateDetail.servicesLabel',
      'templateDetail.composition.title',
      'templateDetail.guidance.title',
      'common.actions.edit',
      'common.actions.close',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
