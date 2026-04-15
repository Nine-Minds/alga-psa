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

describe('TemplateReviewContractStep i18n wiring contract', () => {
  it('T061: review heading, section labels, and service summary copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateReviewContractStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateReview.heading',
      'templateReview.description',
      'templateReview.sections.basics',
      'templateReview.sections.fixedFeeServices',
      'templateReview.sections.products',
      'templateReview.sections.hourlyServices',
      'templateReview.sections.usageBasedServices',
      'templateReview.fields.templateName',
      'templateReview.fields.billingFrequency',
      'templateReview.fields.internalNotes',
      'templateReview.fallback.none',
      'templateReview.fallback.noNotes',
      'templateReview.fallback.unnamedService',
      'templateReview.fallback.unnamedProduct',
      'templateReview.empty.fixed',
      'templateReview.empty.products',
      'templateReview.empty.hourly',
      'templateReview.empty.usage',
      'templateReview.fixed.cadenceOwnerLabel',
      'templateReview.fixed.cadenceOwner.contract',
      'templateReview.fixed.cadenceOwner.client',
      'templateReview.fixed.billingTimingLabel',
      'templateReview.fixed.billingTiming.advance',
      'templateReview.fixed.billingTiming.arrears',
      'templateReview.fixed.partialPeriodLabel',
      'templateReview.fixed.serviceLabel',
      'templateReview.fixed.invoiceWindowLabel',
      'templateReview.hourly.minimumBillableTimeLabel',
      'templateReview.hourly.roundUpLabel',
      'templateReview.hourly.minutes',
      'templateReview.usage.unitLabel',
      'templateReview.common.quantity',
      'templateReview.common.bucket',
      'templateReview.common.enabled',
      'templateReview.common.disabled',
      'templateReview.bucket.hoursIncluded',
      'templateReview.bucket.unitsIncluded',
      'templateReview.bucket.unitsFallback',
      'templateReview.bucket.hourSingular',
      'templateReview.bucket.unitSingular',
      'templateReview.bucket.overage',
      'templateReview.bucket.rolloverEnabled',
      'templateReview.bucket.period',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
