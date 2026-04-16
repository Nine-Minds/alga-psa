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

describe('TemplateUsageBasedServicesStep i18n wiring contract', () => {
  it('T060: step heading, service picker, unit-measure fields, and bucket labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateUsageBasedServicesStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateUsage.heading',
      'templateUsage.description',
      'templateUsage.info.title',
      'templateUsage.info.description',
      'templateUsage.fields.services',
      'templateUsage.fields.serviceNumber',
      'templateUsage.placeholders.selectService',
      'templateUsage.fields.unitOfMeasureOptional',
      'templateUsage.placeholders.unitOfMeasure',
      'templateUsage.help.unitOfMeasure',
      'templateUsage.fields.setBucketAllocation',
      'templateUsage.actions.addService',
      'templateUsage.preview.unknownService',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
