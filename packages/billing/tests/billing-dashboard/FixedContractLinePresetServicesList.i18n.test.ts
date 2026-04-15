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

describe('FixedContractLinePresetServicesList i18n wiring contract', () => {
  it('T021: wires the preset table headers and save/reset buttons through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/FixedContractLinePresetServicesList.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('presetServices.table.serviceName', { defaultValue: 'Service Name' })");
    expect(source).toContain("t('presetServices.table.category', { defaultValue: 'Category' })");
    expect(source).toContain("t('presetServices.table.billingMethod', { defaultValue: 'Billing Method' })");
    expect(source).toContain("t('presetServices.table.quantity', { defaultValue: 'Quantity' })");
    expect(source).toContain("t('presetServices.table.defaultRate', { defaultValue: 'Default Rate' })");
    expect(source).toContain("t('presetServices.table.actions', { defaultValue: 'Actions' })");
    expect(source).toContain("t('presetServices.actions.remove', { defaultValue: 'Remove' })");
    expect(source).toContain("t('presetServices.actions.reset', { defaultValue: 'Reset' })");
    expect(source).toContain("t('presetServices.actions.saving', { defaultValue: 'Saving...' })");
    expect(source).toContain("t('presetServices.actions.saveChanges', { defaultValue: 'Save Changes' })");
    expect(source).toContain("t('presetServices.actions.saveChangesDirty', { defaultValue: 'Save Changes *' })");
    expect(source).toContain("t('contractLineServices.billingMethods.fixed', { defaultValue: 'Fixed Price' })");
    expect(source).toContain("t('contractLineServices.billingMethods.hourly', { defaultValue: 'Hourly' })");
    expect(source).toContain("t('contractLineServices.billingMethods.usageBased', { defaultValue: 'Usage Based' })");
  });

  it('T022: wires the unsaved changes warning and navigation warning dialog through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/FixedContractLinePresetServicesList.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('presetServices.warnings.unsavedChanges', {");
    expect(source).toContain("t('presetServices.navigationDialog.title', { defaultValue: 'Unsaved Changes' })");
    expect(source).toContain("t('presetServices.navigationDialog.message', {");
    expect(source).toContain("t('presetServices.navigationDialog.confirmLabel', { defaultValue: 'Leave Page' })");
    expect(source).toContain("t('presetServices.navigationDialog.cancelLabel', { defaultValue: 'Stay on Page' })");
    expect(source).toContain("t('presetServices.states.loading', { defaultValue: 'Loading services...' })");
    expect(source).toContain("t('presetServices.addSection.title', { defaultValue: 'Add Services to Contract Line' })");
    expect(source).toContain("t('presetServices.unknownService', { defaultValue: 'Unknown Service' })");

    const pseudoKeys = [
      'presetServices.table.serviceName',
      'presetServices.table.defaultRate',
      'presetServices.actions.saveChanges',
      'presetServices.actions.saveChangesDirty',
      'presetServices.actions.saving',
      'presetServices.actions.reset',
      'presetServices.warnings.unsavedChanges',
      'presetServices.navigationDialog.title',
      'presetServices.navigationDialog.message',
      'presetServices.navigationDialog.confirmLabel',
      'presetServices.navigationDialog.cancelLabel',
      'presetServices.states.loading',
      'presetServices.addSection.title',
      'presetServices.unknownService',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});
