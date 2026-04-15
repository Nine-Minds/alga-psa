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

describe('FixedFeeServicesStep i18n wiring contract', () => {
  it('T049: heading, service picker, base-rate/proration, and empty state copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardFixed.heading',
      'wizardFixed.description',
      'wizardFixed.explainer.title',
      'wizardFixed.explainer.description',
      'wizardFixed.baseRate.label',
      'wizardFixed.baseRate.placeholder',
      'wizardFixed.baseRate.hint',
      'wizardFixed.proration.label',
      'wizardFixed.proration.tooltip',
      'wizardFixed.services.label',
      'wizardFixed.services.serviceItemLabel',
      'wizardFixed.services.selectServicePlaceholder',
      'wizardFixed.services.quantityLabel',
      'wizardFixed.services.addService',
      'wizardFixed.emptyState',
      'wizardFixed.alternateFrequencyLabel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
