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

describe('HourlyServicesStep i18n wiring contract', () => {
  it('T051: heading, hourly-rate, minimum-time, and rounding labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardHourly.heading',
      'wizardHourly.description',
      'wizardHourly.explainer.title',
      'wizardHourly.explainer.description',
      'wizardHourly.minimumBillableTime.label',
      'wizardHourly.minimumBillableTime.placeholder',
      'wizardHourly.minimumBillableTime.hint',
      'wizardHourly.roundUpToNearest.label',
      'wizardHourly.roundUpToNearest.placeholder',
      'wizardHourly.roundUpToNearest.hint',
      'wizardHourly.labels.hourlyServices',
      'wizardHourly.labels.serviceItem',
      'wizardHourly.labels.selectServicePlaceholder',
      'wizardHourly.labels.hourlyRate',
      'wizardHourly.labels.hourlyRatePlaceholder',
      'wizardHourly.labels.hourlyRatePerHour',
      'wizardHourly.labels.enterHourlyRate',
      'wizardHourly.labels.setBucketOfHours',
      'wizardHourly.actions.addHourlyService',
      'wizardHourly.emptyState',
      'wizardHourly.alternateFrequencyLabel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
