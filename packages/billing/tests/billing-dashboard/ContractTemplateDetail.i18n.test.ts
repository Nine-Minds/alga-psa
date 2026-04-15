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

describe('ContractTemplateDetail i18n wiring contract', () => {
  it('T013: page header, back actions, and key section labels use msp/contracts keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractTemplateDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'templateDetail.loadingTemplate',
      'templateDetail.templateNotFound',
      'templateDetail.failedToLoadTemplate',
      'templateDetail.backToTemplatesArrow',
      'templateDetail.backToTemplates',
      'templateDetail.templateBadge',
      'templateDetail.templateSnapshotTitle',
      'contractDetail.tabs.lines',
      'templateDetail.servicesLabel',
      'templateDetail.composition.title',
      'templateDetail.guidance.title',
      'common.actions.edit',
      'common.actions.close',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T014: template composition and line/service manager labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractTemplateDetail.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'templateDetail.composition.title',
      'templateDetail.composition.manageServices',
      'templateDetail.composition.closeManager',
      'templateDetail.composition.fixedFeeBundles',
      'templateDetail.composition.hourlyPlans',
      'templateDetail.composition.usageBasedPlans',
      'templateDetail.composition.additionalPlans',
      'templateDetail.composition.noFixedFeeLines',
      'templateDetail.composition.noHourlyLines',
      'templateDetail.composition.noUsageLines',
      'templateDetail.composition.serviceCountSingle',
      'templateDetail.composition.serviceCountPlural',
      'templateDetail.composition.noServicesAssigned',
      'templateDetail.composition.serviceFallback',
      'templateDetail.composition.quantityLabel',
      'templateDetail.composition.unitLabel',
      'templateDetail.composition.minimumTimeLabel',
      'templateDetail.composition.roundUpLabel',
      'templateDetail.composition.minutesValue',
      'templateDetail.composition.bucketSummary',
      'templateDetail.composition.manageTemplateServices',
      'templateDetail.composition.addContractLinesBeforeManaging',
      'templateDetail.composition.fixedFeeRate',
      'templateDetail.composition.editRate',
      'templateDetail.composition.notSet',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T015: cadence and billing-timing option labels resolve via translation keys', () => {
    const templateSource = read('../../src/components/billing-dashboard/contracts/ContractTemplateDetail.tsx');
    const lineEditSource = read('../../src/components/billing-dashboard/contracts/ContractLineEditDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const templateKeyChecks = [
      'templateDetail.form.recommendedBillingFrequencyLabel',
      'templateDetail.form.recommendedBillingFrequencyPlaceholder',
      'templateDetail.guidance.recommendedCadenceLabel',
      'templateDetail.guidance.recommendedCadencePlaceholder',
      'templateDetail.guidance.noCadenceProvided',
    ];

    for (const key of templateKeyChecks) {
      expect(templateSource).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    const billingTimingKeyChecks = [
      'contractLineEdit.sections.billingTiming',
      'contractLineEdit.fields.billingTimingQuestion',
      'contractLineEdit.timingOptions.arrears',
      'contractLineEdit.timingOptions.advance',
      'contractLineEdit.timingDescriptions.arrears',
      'contractLineEdit.timingDescriptions.advance',
    ];

    for (const key of billingTimingKeyChecks) {
      expect(lineEditSource).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T016: ContractTemplateDetail translation keys resolve to pseudo-locale values in xx', () => {
    const source = read('../../src/components/billing-dashboard/contracts/ContractTemplateDetail.tsx');
    const xx = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/contracts.json'
    );

    const keys = Array.from(
      new Set(Array.from(source.matchAll(/(?:^|[^\w])t\('([^']+)'/g), (match) => match[1]))
    );

    expect(keys.length).toBeGreaterThan(60);

    for (const key of keys) {
      const value = getLeaf(xx, key);
      expect(typeof value).toBe('string');
      expect(value).toContain('11111');
    }
  });
});
