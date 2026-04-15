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

describe('ContractLines i18n wiring contract', () => {
  it('T020: section header, add/create controls, summary labels, and empty states use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractLines.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractLines.title',
      'contractLines.description.default',
      'contractLines.description.readOnly',
      'contractLines.actions.addFromPresets',
      'contractLines.actions.createCustom',
      'contractLines.actions.expandLine',
      'contractLines.actions.collapseLine',
      'contractLines.columns.name',
      'contractLines.columns.type',
      'contractLines.columns.frequency',
      'contractLines.columns.rate',
      'contractLines.columns.services',
      'contractLines.columns.actions',
      'contractLines.serviceCountSingle',
      'contractLines.serviceCountPlural',
      'contractLines.customRate',
      'contractLines.empty.noneAdded',
      'contractLines.empty.selectAbove',
      'contractLines.loading.contractLines',
      'common.actions.edit',
      'common.actions.remove',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T021: inline edit fields, service details, and delete confirmation use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractLines.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'contractLines.dialogs.confirmRemove',
      'contractLines.configuration.title',
      'contractLines.configuration.description',
      'contractLines.configuration.minimumBillableTime',
      'contractLines.configuration.roundUpToNearest',
      'contractLines.configuration.minutesValue',
      'contractLines.configuration.fixedInfo',
      'contractLines.configuration.fixedInfoHeading',
      'contractLines.configuration.fixedInfoDetails',
      'contractLines.configuration.usageInfo',
      'contractLines.services.title',
      'contractLines.services.empty',
      'contractLines.services.typeLabel',
      'contractLines.services.quantityShort',
      'contractLines.services.quantity',
      'contractLines.services.quantityTaxAllocation',
      'contractLines.services.hourlyRate',
      'contractLines.services.unitRate',
      'contractLines.services.rateTaxAllocation',
      'contractLines.services.unitOfMeasure',
      'contractLines.services.unitPlaceholder',
      'contractLines.bucket.enableTracking',
      'contractLines.bucket.title',
      'contractLines.bucket.included',
      'contractLines.bucket.hoursValue',
      'contractLines.bucket.unitsValue',
      'contractLines.bucket.overageRate',
      'contractLines.bucket.hour',
      'contractLines.bucket.defaultUnit',
      'contractLines.bucket.defaultUnits',
      'contractLines.bucket.billingPeriod',
      'contractLines.bucket.rolloverEnabled',
      'billing.labels.timing',
      'billing.labels.cadenceOwner',
      'billing.timing.arrears',
      'billing.timing.advance',
      'billing.cadenceOwner.client',
      'billing.cadenceOwner.contract',
      'common.actions.save',
      'common.actions.saving',
      'common.actions.cancel',
      'contractLines.errors.cannotEditWithInvoices',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T022: ContractLines translation keys resolve to pseudo-locale values in xx', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractLines.tsx');
    const xx = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/contracts.json'
    );

    const keys = Array.from(
      new Set(Array.from(source.matchAll(/(?:^|[^\w])t\('([^']+)'/g), (match) => match[1]))
    );

    expect(keys.length).toBeGreaterThanOrEqual(70);

    for (const key of keys) {
      const value = getLeaf(xx, key);
      expect(typeof value).toBe('string');
      expect(value).toContain('11111');
    }
  });
});
