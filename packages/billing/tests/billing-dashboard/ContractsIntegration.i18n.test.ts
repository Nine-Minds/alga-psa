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

function getTranslationKeys(source: string): string[] {
  return Array.from(new Set(Array.from(source.matchAll(/(?:^|[^\w])t\('([^']+)'/g), (match) => match[1])));
}

describe('Contracts integration i18n coverage', () => {
  it('T063: /msp/billing contracts tab wiring resolves sub-tab/list translations via msp/contracts in en', () => {
    const configSource = read('../../../../packages/core/src/lib/i18n/config.ts');
    const contractsSource = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const clientContractsSource = read('../../src/components/billing-dashboard/contracts/ClientContractsTab.tsx');
    const templatesSource = read('../../src/components/billing-dashboard/contracts/TemplatesTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(configSource).toContain("'/msp/billing': ['common', 'msp/core', 'features/billing', 'msp/reports', 'msp/billing', 'msp/contract-lines', 'msp/contracts']");

    expect(contractsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(clientContractsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templatesSource).toContain("const { t } = useTranslation('msp/contracts');");

    expect(contractsSource).toContain("t('common.tabs.templates'");
    expect(contractsSource).toContain("t('common.tabs.clientContracts'");
    expect(contractsSource).toContain("t('common.tabs.drafts'");
    expect(contractsSource).not.toContain('CONTRACT_SUBTAB_LABELS');

    const keySet = new Set<string>([
      ...getTranslationKeys(contractsSource),
      ...getTranslationKeys(clientContractsSource),
      ...getTranslationKeys(templatesSource),
    ]);

    expect(keySet.size).toBeGreaterThan(80);

    for (const key of keySet) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T064: /msp/billing contracts view resolves de locale sub-tab labels, column headers, and action-menu keys', () => {
    const contractsSource = read('../../src/components/billing-dashboard/contracts/Contracts.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );
    const de = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/de/msp/contracts.json'
    );

    const localeKeys = [
      'common.tabs.templates',
      'common.tabs.clientContracts',
      'common.tabs.drafts',
      'contractsList.columns.contractName',
      'contractsList.columns.client',
      'contractsList.columns.status',
      'contractsList.columns.startDate',
      'contractsList.columns.endDate',
      'contractsList.actions.openMenu',
      'contractsList.actions.resume',
      'contractsList.actions.terminate',
      'contractsList.actions.restore',
      'contractsList.actions.createContract',
      'contractsList.actions.createTemplate',
    ];

    for (const key of localeKeys) {
      expect(getLeaf(en, key)).toBeDefined();
      expect(getLeaf(de, key)).toBeDefined();
    }

    expect(getLeaf(de, 'common.tabs.templates')).not.toBe(getLeaf(en, 'common.tabs.templates'));
    expect(getLeaf(de, 'common.tabs.clientContracts')).not.toBe(
      getLeaf(en, 'common.tabs.clientContracts')
    );
    expect(getLeaf(de, 'common.tabs.drafts')).not.toBe(getLeaf(en, 'common.tabs.drafts'));

    const requiredSourceKeys = [
      'common.tabs.templates',
      'common.tabs.clientContracts',
      'common.tabs.drafts',
      'contractsList.columns.contractName',
      'contractsList.columns.client',
      'contractsList.columns.status',
      'contractsList.columns.startDate',
      'contractsList.columns.endDate',
      'contractsList.actions.openMenu',
      'contractsList.actions.resume',
      'contractsList.actions.terminate',
      'contractsList.actions.restore',
    ];

    for (const key of requiredSourceKeys) {
      expect(contractsSource).toContain(`t('${key}'`);
    }
  });

  it('T065: contract detail route wiring resolves German translations across detail, lines, and pricing tabs', () => {
    const contractDetailSource = read('../../src/components/billing-dashboard/contracts/ContractDetail.tsx');
    const contractLinesSource = read('../../src/components/billing-dashboard/contracts/ContractLines.tsx');
    const pricingSchedulesSource = read('../../src/components/billing-dashboard/contracts/PricingSchedules.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );
    const de = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/de/msp/contracts.json'
    );

    expect(contractDetailSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(contractLinesSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(pricingSchedulesSource).toContain("const { t } = useTranslation('msp/contracts');");

    const keySet = new Set<string>([
      ...getTranslationKeys(contractDetailSource),
      ...getTranslationKeys(contractLinesSource),
      ...getTranslationKeys(pricingSchedulesSource),
    ]);

    expect(keySet.size).toBeGreaterThan(200);

    for (const key of keySet) {
      expect(getLeaf(en, key)).toBeDefined();
      expect(getLeaf(de, key)).toBeDefined();
    }

    const translatedTabKeys = [
      'contractDetail.tabs.overview',
      'contractDetail.tabs.lines',
      'contractDetail.tabs.pricing',
      'contractDetail.tabs.documents',
      'contractDetail.tabs.invoices',
    ];

    for (const key of translatedTabKeys) {
      expect(getLeaf(de, key)).not.toBe(getLeaf(en, key));
    }
  });

  it('T066: contract creation wizard wiring resolves all step/form translation keys in de locale', () => {
    const wizardSource = read('../../src/components/billing-dashboard/contracts/ContractWizard.tsx');
    const basicsSource = read(
      '../../src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx'
    );
    const fixedSource = read(
      '../../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx'
    );
    const productsSource = read(
      '../../src/components/billing-dashboard/contracts/wizard-steps/ProductsStep.tsx'
    );
    const hourlySource = read(
      '../../src/components/billing-dashboard/contracts/wizard-steps/HourlyServicesStep.tsx'
    );
    const usageSource = read(
      '../../src/components/billing-dashboard/contracts/wizard-steps/UsageBasedServicesStep.tsx'
    );
    const reviewSource = read(
      '../../src/components/billing-dashboard/contracts/wizard-steps/ReviewContractStep.tsx'
    );
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );
    const de = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/de/msp/contracts.json'
    );

    expect(wizardSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(basicsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(fixedSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(productsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(hourlySource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(usageSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(reviewSource).toContain("const { t } = useTranslation('msp/contracts');");

    const keySet = new Set<string>([
      ...getTranslationKeys(wizardSource),
      ...getTranslationKeys(basicsSource),
      ...getTranslationKeys(fixedSource),
      ...getTranslationKeys(productsSource),
      ...getTranslationKeys(hourlySource),
      ...getTranslationKeys(usageSource),
      ...getTranslationKeys(reviewSource),
    ]);

    expect(keySet.size).toBeGreaterThan(220);

    for (const key of keySet) {
      if (
        key === 'wizardBasics.summary.values.noticePeriodDays' ||
        key === 'wizardBasics.summary.values.renewalTermMonths'
      ) {
        expect(getLeaf(en, `${key}_one`)).toBeDefined();
        expect(getLeaf(en, `${key}_other`)).toBeDefined();
        expect(getLeaf(de, `${key}_one`)).toBeDefined();
        expect(getLeaf(de, `${key}_other`)).toBeDefined();
        continue;
      }

      expect(getLeaf(en, key)).toBeDefined();
      expect(getLeaf(de, key)).toBeDefined();
    }
  });

  it('T067: template creation wizard wiring resolves all step/form translation keys in de locale', () => {
    const templateWizardSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/TemplateWizard.tsx'
    );
    const templateBasicsSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateContractBasicsStep.tsx'
    );
    const templateFixedSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateFixedFeeServicesStep.tsx'
    );
    const templateProductsSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateProductsStep.tsx'
    );
    const templateHourlySource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateHourlyServicesStep.tsx'
    );
    const templateUsageSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateUsageBasedServicesStep.tsx'
    );
    const templateReviewSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/steps/TemplateReviewContractStep.tsx'
    );
    const templatePreviewSource = read(
      '../../src/components/billing-dashboard/contracts/template-wizard/TemplateServicePreviewSection.tsx'
    );
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );
    const de = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/de/msp/contracts.json'
    );

    expect(templateWizardSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templateBasicsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templateFixedSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templateProductsSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templateHourlySource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templateUsageSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templateReviewSource).toContain("const { t } = useTranslation('msp/contracts');");
    expect(templatePreviewSource).toContain("const { t } = useTranslation('msp/contracts');");

    const keySet = new Set<string>([
      ...getTranslationKeys(templateWizardSource),
      ...getTranslationKeys(templateBasicsSource),
      ...getTranslationKeys(templateFixedSource),
      ...getTranslationKeys(templateProductsSource),
      ...getTranslationKeys(templateHourlySource),
      ...getTranslationKeys(templateUsageSource),
      ...getTranslationKeys(templateReviewSource),
      ...getTranslationKeys(templatePreviewSource),
    ]);

    expect(keySet.size).toBeGreaterThan(120);

    for (const key of keySet) {
      expect(getLeaf(en, key)).toBeDefined();
      expect(getLeaf(de, key)).toBeDefined();
    }
  });
});
