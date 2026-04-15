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

describe('AddContractLinesDialog i18n wiring contract', () => {
  it('T023: dialog title, search/filter controls, and preset selection labels use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/AddContractLinesDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    expect(source).toContain("const { t } = useTranslation('msp/contracts');");

    const keyChecks = [
      'addLines.title',
      'addLines.selectPresetsTitle',
      'addLines.filters.searchPlaceholder',
      'addLines.filters.allTypes',
      'addLines.filters.typePlaceholder',
      'addLines.filters.reset',
      'addLines.loading',
      'addLines.empty.noneAvailable',
      'addLines.empty.noMatches',
      'addLines.actions.adding',
      'addLines.actions.addSingle',
      'addLines.actions.addPlural',
      'addLines.selection.selectPreset',
      'addLines.selection.deselectPreset',
      'addLines.selection.selectedSingle',
      'addLines.selection.selectedPlural',
      'addLines.serviceCountSingle',
      'addLines.serviceCountPlural',
      'common.actions.cancel',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T024: expanded preset details and error/loading states use translated keys', () => {
    const source = read('../../src/components/billing-dashboard/contracts/AddContractLinesDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/contracts.json'
    );

    const keyChecks = [
      'addLines.errors.failedToLoadPresets',
      'addLines.errors.failedToLoadPresetDetails',
      'addLines.errors.failedToAddPresets',
      'addLines.loading',
      'addLines.empty.noneAvailable',
      'addLines.empty.noMatches',
      'addLines.services.unknownService',
      'addLines.fixedConfig.title',
      'addLines.fixedConfig.defaultBaseRate',
      'addLines.fixedConfig.notSet',
      'addLines.fixedConfig.overrideBaseRate',
      'addLines.fixedConfig.defaultRatePlaceholder',
      'addLines.fixedConfig.enterBaseRate',
      'addLines.fixedConfig.leaveBlankDefault',
      'addLines.services.includedReference',
      'addLines.services.configuration',
      'addLines.services.empty',
      'addLines.services.fixedReferenceHelp',
      'addLines.services.quantityShort',
      'addLines.hourlyConfig.title',
      'addLines.hourlyConfig.minimumBillableMinutes',
      'addLines.hourlyConfig.roundUpToNearest',
      'addLines.hourlyConfig.servicesAndRates',
      'addLines.hourlyConfig.hourlyRate',
      'addLines.hourlyConfig.defaultRate',
      'addLines.usageConfig.quantity',
      'addLines.usageConfig.ratePerUnit',
      'addLines.usageConfig.defaultRate',
      'addLines.usageConfig.unitOfMeasure',
      'addLines.usageConfig.unitPlaceholder',
      'addLines.usageConfig.unitHint',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
