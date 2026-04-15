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

describe('CreateCustomContractLineDialog i18n wiring contract', () => {
  it('T017: dialog shell, billing model selector, and service-picker labels use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'createCustomLine.title',
      'createCustomLine.basicsTitle',
      'createCustomLine.basicsDescription',
      'createCustomLine.contractLineNameLabel',
      'createCustomLine.contractLineNamePlaceholder',
      'createCustomLine.billingFrequencyLabel',
      'createCustomLine.billingFrequencyPlaceholder',
      'createCustomLine.billingTiming.advance',
      'createCustomLine.billingTiming.arrears',
      'createCustomLine.billingTimingHelp',
      'createCustomLine.chooseBillingModel',
      'createCustomLine.chooseBillingModelDescription',
      'createCustomLine.billingModel.fixedTitle',
      'createCustomLine.billingModel.hourlyTitle',
      'createCustomLine.billingModel.usageTitle',
      'createCustomLine.fixedServicesTitle',
      'createCustomLine.hourlyServicesTitle',
      'createCustomLine.usageServicesTitle',
      'createCustomLine.servicesAndProductsLabel',
      'createCustomLine.serviceLabel',
      'createCustomLine.selectItemPlaceholder',
      'createCustomLine.selectServicePlaceholder',
      'common.actions.cancel',
      'createCustomLine.create',
      'createCustomLine.creating',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T018: bucket/proration labels and validation errors use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/CreateCustomContractLineDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'createCustomLine.adjustForPartialPeriods',
      'createCustomLine.adjustForPartialPeriodsHelp',
      'createCustomLine.minimumBillableTimeLabel',
      'createCustomLine.roundUpToNearestLabel',
      'createCustomLine.addBucketOfHours',
      'createCustomLine.addBucketOfConsumption',
      'createCustomLine.validation.contractLineNameRequired',
      'createCustomLine.validation.billingFrequencyRequired',
      'createCustomLine.validation.contractLineTypeRequired',
      'createCustomLine.validation.fixedServiceRequired',
      'createCustomLine.validation.fixedServiceSelectRequired',
      'createCustomLine.validation.hourlyServiceRequired',
      'createCustomLine.validation.hourlyServiceSelectRequired',
      'createCustomLine.validation.hourlyRateRequired',
      'createCustomLine.validation.usageServiceRequired',
      'createCustomLine.validation.usageServiceSelectRequired',
      'createCustomLine.validation.unitRateRequired',
      'createCustomLine.validation.unitOfMeasureRequired',
      'createCustomLine.validation.failedToCreate',
      'common.errors.validationPrefix',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
