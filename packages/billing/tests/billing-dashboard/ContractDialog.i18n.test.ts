// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pseudoPattern } from '../../../../tools/i18n/lib/pseudo-locale.mjs';

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

// The preset section now lives in the shared picker/hook, so the dialog's
// translated strings span all three files.
const dialogSources = [
  '../../src/components/billing-dashboard/contracts/ContractDialog.tsx',
  '../../src/components/billing-dashboard/contracts/ContractLinePresetPicker.tsx',
  '../../src/components/billing-dashboard/contracts/useContractLinePresetSelection.ts',
];

function readAll(relativePaths: string[]): string {
  return relativePaths.map(read).join('\n');
}

describe('ContractDialog i18n wiring contract', () => {
  it('T010: title, primary form labels, and validation errors use msp/contracts translation keys', () => {
    const source = readAll(dialogSources);
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'contractDialog.title.create',
      'contractDialog.title.edit',
      'contractDialog.form.clientLabel',
      'contractDialog.form.contractNameLabel',
      'contractDialog.form.billingFrequencyLabel',
      'contractDialog.form.currencyHint',
      'contractDialog.form.startDateLabel',
      'contractDialog.form.endDateLabel',
      'contractDialog.form.descriptionLabel',
      'contractDialog.form.renewalSettingsTitle',
      'contractDialog.form.renewalSettingsDescription',
      'contractDialog.form.useTenantDefaultsLabel',
      'contractDialog.form.noticePeriodLabel',
      'contractDialog.form.renewalTermLabel',
      'contractDialog.validation.requiredFields',
      'contractDialog.validation.client',
      'contractDialog.validation.contractName',
      'contractDialog.validation.billingFrequency',
      'contractDialog.validation.startDate',
      'contractDialog.validation.poNumberRequired',
      'contractDialog.validation.noticePeriodInvalid',
      'contractDialog.validation.renewalTermInvalid',
      'contractDialog.validation.failedToSave',
      'renewal.labels.mode',
      'renewal.modes.manual',
      'renewal.modes.auto',
      'renewal.modes.none',
      'common.actions.cancel',
      'contractDialog.actions.updateContract',
      'contractDialog.actions.createContract',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T011: PO fields and preset-picker sections use msp/contracts translation keys', () => {
    const source = readAll(dialogSources);
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'contractDialog.po.requirePurchaseOrder',
      'contractDialog.po.requirePurchaseOrderTooltip',
      'contractDialog.po.noteLabel',
      'contractDialog.po.comingSoon',
      'contractDialog.po.numberLabel',
      'contractDialog.po.numberPlaceholder',
      'contractDialog.po.amountLabel',
      'contractDialog.po.amountPlaceholder',
      'contractDialog.presets.heading',
      'contractDialog.presets.headingTooltip',
      'contractDialog.presets.loading',
      'contractDialog.presets.empty',
      'contractDialog.presets.searchPlaceholder',
      'contractDialog.presets.noMatches',
      'contractDialog.presets.selectedSingle',
      'contractDialog.presets.selectedPlural',
      // Filter chrome and service counts come from the shared picker, whose
      // addLines.* copy is identical in every locale.
      'addLines.filters.allTypes',
      'addLines.filters.typePlaceholder',
      'addLines.filters.reset',
      'addLines.serviceCountSingle',
      'addLines.serviceCountPlural',
      'addLines.fixedConfig.title',
      'addLines.services.configuration',
      'addLines.services.includedReference',
      'addLines.services.empty',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T012: ContractDialog translation keys resolve to pseudo-locale values in xx', () => {
    const source = readAll(dialogSources);
    const xx = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/contracts.json'
    );

    const keys = Array.from(
      new Set(Array.from(source.matchAll(/(?:^|[^\w])t\('([^']+)'/g), (match) => match[1]))
    );

    expect(keys.length).toBeGreaterThan(80);

    for (const key of keys) {
      const value = getLeaf(xx, key);
      expect(typeof value).toBe('string');
      expect(value).toMatch(pseudoPattern('xx'));
    }
  });
});
