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

describe('UsageBasedServicesStep i18n wiring contract', () => {
  it('T052: step heading, unit-rate/unit-of-measure labels, and bucket copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/UsageBasedServicesStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardUsage.heading',
      'wizardUsage.description',
      'wizardUsage.explainer.title',
      'wizardUsage.explainer.description',
      'wizardUsage.labels.services',
      'wizardUsage.labels.serviceItem',
      'wizardUsage.labels.selectServicePlaceholder',
      'wizardUsage.labels.ratePerUnit',
      'wizardUsage.labels.ratePerUnitPlaceholder',
      'wizardUsage.labels.ratePerUnitValue',
      'wizardUsage.labels.enterUnitRate',
      'wizardUsage.labels.unitOfMeasure',
      'wizardUsage.labels.unitOfMeasurePlaceholder',
      'wizardUsage.labels.unitOfMeasureHint',
      'wizardUsage.values.defaultUnit',
      'wizardUsage.labels.setBucketAllocation',
      'wizardUsage.actions.addUsageBasedService',
      'wizardUsage.emptyState',
      'wizardUsage.alternateFrequencyLabel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
