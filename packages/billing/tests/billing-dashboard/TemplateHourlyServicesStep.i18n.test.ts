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

describe('TemplateHourlyServicesStep i18n wiring contract', () => {
  it('T059: heading, service picker, bucket toggle, and minimum/rounding labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateHourlyServicesStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateHourly.heading',
      'templateHourly.description',
      'templateHourly.info.title',
      'templateHourly.info.description',
      'templateHourly.rounding.heading',
      'templateHourly.rounding.minimumBillableTime',
      'templateHourly.rounding.defaultIntervalPlaceholder',
      'templateHourly.rounding.minimumBillableTimeHelp',
      'templateHourly.rounding.roundUpToNearest',
      'templateHourly.rounding.roundUpToNearestHelp',
      'templateHourly.fields.services',
      'templateHourly.fields.serviceNumber',
      'templateHourly.placeholders.selectService',
      'templateHourly.fields.setBucketOfHours',
      'templateHourly.actions.addService',
      'templateHourly.preview.unknownService',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
