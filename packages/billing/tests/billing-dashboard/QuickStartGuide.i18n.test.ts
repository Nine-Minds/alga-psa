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

describe('QuickStartGuide i18n wiring contract', () => {
  it('T038: step copy, billing model labels, and best-practice items use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/QuickStartGuide.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'quickStart.title',
      'quickStart.subtitle',
      'quickStart.badge.new',
      'quickStart.actions.showGuide',
      'quickStart.actions.minimize',
      'quickStart.actions.dismiss',
      'quickStart.actions.createFirstContract',
      'quickStart.steps.createContract.title',
      'quickStart.steps.createContract.description',
      'quickStart.steps.createContract.requiredFields',
      'quickStart.steps.configureBilling.title',
      'quickStart.steps.configureBilling.description',
      'quickStart.steps.reviewCreate.title',
      'quickStart.steps.reviewCreate.description',
      'quickStart.steps.reviewCreate.tip',
      'quickStart.billingModels.fixedFee.label',
      'quickStart.billingModels.fixedFee.description',
      'quickStart.billingModels.hourly.label',
      'quickStart.billingModels.hourly.description',
      'quickStart.billingModels.bucketHours.label',
      'quickStart.billingModels.bucketHours.description',
      'quickStart.billingModels.usageBased.label',
      'quickStart.billingModels.usageBased.description',
      'quickStart.bestPractices.title',
      'quickStart.bestPractices.items.clearNames',
      'quickStart.bestPractices.items.partialPeriodAdjustment',
      'quickStart.bestPractices.items.endDates',
      'quickStart.bestPractices.items.poNumbers',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
