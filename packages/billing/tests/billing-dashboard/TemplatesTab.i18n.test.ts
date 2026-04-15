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

describe('TemplatesTab i18n wiring contract', () => {
  it('T036: template columns/status/search/actions/loading/empty/error labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/TemplatesTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templatesTab.columns.templateName',
      'templatesTab.columns.description',
      'templatesTab.columns.status',
      'templatesTab.columns.actions',
      'templatesTab.status.active',
      'templatesTab.status.draft',
      'templatesTab.status.terminated',
      'templatesTab.status.expired',
      'templatesTab.status.published',
      'templatesTab.status.archived',
      'templatesTab.search.placeholder',
      'templatesTab.search.ariaLabel',
      'templatesTab.actions.createTemplate',
      'templatesTab.actions.edit',
      'templatesTab.actions.delete',
      'templatesTab.loading',
      'templatesTab.errors.failedToFetchTemplates',
      'templatesTab.errors.failedToDeleteContract',
      'templatesTab.values.noDescription',
      'templatesTab.empty.noSearchMatches',
      'templatesTab.empty.noTemplates',
      'templatesTab.empty.tryDifferentSearch',
      'templatesTab.empty.createFirstTemplate',
      'common.actions.openMenu',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
