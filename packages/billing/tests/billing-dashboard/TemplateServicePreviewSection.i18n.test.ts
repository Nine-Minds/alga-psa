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

describe('TemplateServicePreviewSection i18n wiring contract', () => {
  it('T062: service-type labels, heading interpolation, and remove dialog copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/template-wizard/TemplateServicePreviewSection.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templatePreview.serviceType.fixedFee',
      'templatePreview.serviceType.products',
      'templatePreview.serviceType.hourly',
      'templatePreview.serviceType.usageBased',
      'templatePreview.selectedHeading',
      'templatePreview.labels.qty',
      'templatePreview.removeDialog.title',
      'templatePreview.removeDialog.message',
      'templatePreview.removeDialog.confirm',
      'templatePreview.removeDialog.cancel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
