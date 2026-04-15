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

describe('ContractBasicsStep i18n wiring contract', () => {
  it('T047: step heading, template-picker labels, and client-picker labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'wizardBasics.heading',
      'wizardBasics.description',
      'wizardBasics.template.startFromTemplate',
      'wizardBasics.template.loadingTemplates',
      'wizardBasics.template.selectTemplateOptional',
      'wizardBasics.template.prefillHint',
      'wizardBasics.template.loadingTemplateDetails',
      'wizardBasics.template.preview.templateLabel',
      'wizardBasics.template.preview.billingCadenceLabel',
      'wizardBasics.template.preview.notSpecified',
      'wizardBasics.client.clientLabel',
      'wizardBasics.client.loadingClients',
      'wizardBasics.client.selectClient',
      'wizardBasics.client.chooseClientHint',
      'wizardBasics.contractName.label',
      'wizardBasics.contractName.placeholder',
      'wizardBasics.contractName.hint',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T048: renewal, PO, and cadence-owner option copy use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'wizardBasics.cadenceOwner.label',
      'wizardBasics.cadenceOwner.description',
      'wizardBasics.cadenceOwner.options.client.label',
      'wizardBasics.cadenceOwner.options.client.description',
      'wizardBasics.cadenceOwner.options.contract.label',
      'wizardBasics.cadenceOwner.options.contract.description',
      'wizardBasics.renewal.modeOptions.none',
      'wizardBasics.renewal.modeOptions.manual',
      'wizardBasics.renewal.modeOptions.auto',
      'wizardBasics.renewal.fixedTerm.title',
      'wizardBasics.renewal.fixedTerm.description',
      'wizardBasics.renewal.evergreen.title',
      'wizardBasics.renewal.evergreen.description',
      'wizardBasics.renewal.useTenantDefaultsLabel',
      'wizardBasics.renewal.useTenantDefaultsDescription',
      'wizardBasics.renewal.modeLabel',
      'wizardBasics.renewal.modePlaceholder',
      'wizardBasics.renewal.noticePeriodLabel',
      'wizardBasics.renewal.noticePeriodPlaceholder',
      'wizardBasics.renewal.termLabel',
      'wizardBasics.renewal.termPlaceholder',
      'wizardBasics.po.title',
      'wizardBasics.po.requireForInvoicing',
      'wizardBasics.po.requireTooltip',
      'wizardBasics.po.requireHint',
      'wizardBasics.po.noteLabel',
      'wizardBasics.po.noteText',
      'wizardBasics.po.numberLabel',
      'wizardBasics.po.numberPlaceholder',
      'wizardBasics.po.numberHint',
      'wizardBasics.po.amountLabel',
      'wizardBasics.po.amountHint',
      'wizardBasics.summary.labels.renewalMode',
      'wizardBasics.summary.labels.noticePeriod',
      'wizardBasics.summary.labels.renewalTerm',
      'wizardBasics.summary.labels.poRequired',
      'wizardBasics.summary.labels.poNumber',
      'wizardBasics.summary.labels.poAmount',
      'common.labels.yes',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }

    expect(source).toContain("t('wizardBasics.summary.values.noticePeriodDays'");
    expect(source).toContain("t('wizardBasics.summary.values.renewalTermMonths'");
    expect(getLeaf(en, 'wizardBasics.summary.values.noticePeriodDays_one')).toBeDefined();
    expect(getLeaf(en, 'wizardBasics.summary.values.noticePeriodDays_other')).toBeDefined();
    expect(getLeaf(en, 'wizardBasics.summary.values.renewalTermMonths_one')).toBeDefined();
    expect(getLeaf(en, 'wizardBasics.summary.values.renewalTermMonths_other')).toBeDefined();
  });
});
