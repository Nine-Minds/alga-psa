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

describe('TemplateFixedFeeServicesStep i18n wiring contract', () => {
  it('T057: step heading, service picker fields, and preview copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateFixed.heading',
      'templateFixed.description',
      'templateFixed.info.title',
      'templateFixed.info.description',
      'templateFixed.cadenceOwner.label',
      'templateFixed.cadenceOwner.help',
      'templateFixed.cadenceOwner.client.label',
      'templateFixed.cadenceOwner.client.description',
      'templateFixed.cadenceOwner.contract.label',
      'templateFixed.cadenceOwner.contract.description',
      'templateFixed.fields.billingTiming',
      'templateFixed.placeholders.billingTiming',
      'templateFixed.billingTiming.arrears',
      'templateFixed.billingTiming.advance',
      'templateFixed.fields.adjustPartialPeriods',
      'templateFixed.help.adjustPartialPeriods',
      'templateFixed.fields.services',
      'templateFixed.fields.serviceNumber',
      'templateFixed.placeholders.selectService',
      'templateFixed.fields.quantityOptional',
      'templateFixed.help.quantity',
      'templateFixed.actions.addService',
      'templateFixed.preview.cadenceOwnerLabel',
      'templateFixed.preview.billingTimingLabel',
      'templateFixed.preview.serviceLabel',
      'templateFixed.preview.invoiceWindowLabel',
      'templateFixed.preview.unknownService',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
