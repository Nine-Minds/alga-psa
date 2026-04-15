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

describe('ReviewContractStep i18n wiring contract', () => {
  it('T053: Contract Basics section labels and fallback values use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardReview.heading',
      'wizardReview.description',
      'wizardReview.sections.contractBasics',
      'wizardReview.fields.client',
      'wizardReview.fields.contractName',
      'wizardReview.fields.billingFrequency',
      'wizardReview.fields.currency',
      'wizardReview.fields.startDate',
      'wizardReview.fields.endDate',
      'wizardReview.fields.renewalMode',
      'wizardReview.fields.noticePeriod',
      'wizardReview.fields.renewalTerm',
      'wizardReview.fallback.notSelected',
      'wizardReview.fallback.notSpecified',
      'wizardReview.fallback.notApplicable',
      'wizardReview.fallback.ongoing',
      'wizardReview.renewalMode.none',
      'wizardReview.renewalMode.manual',
      'wizardReview.renewalMode.auto',
      'wizardReview.noticePeriod.one',
      'wizardReview.noticePeriod.other',
      'wizardReview.renewalTerm.one',
      'wizardReview.renewalTerm.other',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T054: service summary sections, rate copy, and bucket summary strings use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'wizardReview.sections.fixedFeeServices',
      'wizardReview.sections.products',
      'wizardReview.sections.hourlyServices',
      'wizardReview.sections.usageBasedServices',
      'wizardReview.fixed.badgeCount.one',
      'wizardReview.fixed.badgeCount.other',
      'wizardReview.fixed.monthlyBaseRate',
      'wizardReview.fixed.partialPeriodAdjustment',
      'wizardReview.products.badgeCount.one',
      'wizardReview.products.badgeCount.other',
      'wizardReview.products.overrideRate',
      'wizardReview.hourly.badgeCount.one',
      'wizardReview.hourly.badgeCount.other',
      'wizardReview.hourly.servicesAndRates',
      'wizardReview.hourly.serviceRateRow',
      'wizardReview.hourly.minimumTimeLabel',
      'wizardReview.hourly.roundUpLabel',
      'wizardReview.hourly.minutesValue',
      'wizardReview.usage.badgeCount.one',
      'wizardReview.usage.badgeCount.other',
      'wizardReview.usage.serviceRateRow',
      'wizardReview.bucket.includedHours',
      'wizardReview.bucket.includedUnits',
      'wizardReview.bucket.overageLabel',
      'wizardReview.bucket.rolloverEnabled',
      'wizardReview.bucket.rolloverDisabled',
      'wizardReview.bucket.summaryWithOverage',
      'wizardReview.bucket.summaryWithoutOverage',
      'wizardReview.po.title',
      'wizardReview.po.requiredLabel',
      'wizardReview.po.numberLabel',
      'wizardReview.po.amountLabel',
      'wizardReview.total.title',
      'wizardReview.total.description',
      'wizardReview.total.perMonth',
      'wizardReview.finalChecklist.title',
      'wizardReview.finalChecklist.itemRates',
      'wizardReview.finalChecklist.itemPo',
      'wizardReview.finalChecklist.itemDates',
      'wizardReview.finalChecklist.itemEditLater',
      'wizardReview.common.bucketLabel',
      'wizardReview.common.serviceQuantityRow',
      'wizardReview.common.billingFrequencyOverrideLabel',
      'wizardReview.common.yes',
      'wizardReview.common.no',
      'wizardReview.common.enabled',
      'wizardReview.common.disabled',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
