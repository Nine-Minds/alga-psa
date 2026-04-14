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

describe('UsageTracking i18n wiring contract', () => {
  it('T012: wires the usage records table headers and row action labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/UsageTracking.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('usage.bucketHoursOverview', { defaultValue: 'Bucket Hours Overview' })");
    expect(source).toContain("t('usage.usageRecords', { defaultValue: 'Usage Records' })");
    expect(source).toContain("t('usage.table.client', { defaultValue: 'Client' })");
    expect(source).toContain("t('usage.table.service', { defaultValue: 'Service' })");
    expect(source).toContain("t('usage.table.quantity', { defaultValue: 'Quantity' })");
    expect(source).toContain("t('usage.table.usageDate', { defaultValue: 'Usage Date' })");
    expect(source).toContain("t('usage.table.contractLine', { defaultValue: 'Contract Line' })");
    expect(source).toContain("t('usage.table.actions', { defaultValue: 'Actions' })");
    expect(source).toContain("t('usage.actions.edit', { defaultValue: 'Edit' })");
    expect(source).toContain("t('usage.actions.delete', { defaultValue: 'Delete' })");
    expect(source).toContain("t('usage.actions.addUsage', { defaultValue: 'Add Usage' })");
  });

  it('T013: wires the add/edit dialog labels, delete confirmation, and toast messages through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/UsageTracking.tsx');

    expect(source).toContain("t('usage.dialog.editTitle', { defaultValue: 'Edit Usage Record' })");
    expect(source).toContain("t('usage.dialog.addTitle', { defaultValue: 'Add Usage Record' })");
    expect(source).toContain("t('usage.dialog.fields.client', { defaultValue: 'Client' })");
    expect(source).toContain("t('usage.dialog.fields.service', { defaultValue: 'Service' })");
    expect(source).toContain("t('usage.dialog.fields.quantity', { defaultValue: 'Quantity' })");
    expect(source).toContain("t('usage.dialog.fields.usageDate', { defaultValue: 'Usage Date' })");
    expect(source).toContain("t('usage.dialog.fields.comments', { defaultValue: 'Comments (Optional)' })");
    expect(source).toContain("t('usage.actions.updateUsage', { defaultValue: 'Update Usage' })");
    expect(source).toContain("t('usage.deleteDialog.title', { defaultValue: 'Delete Usage Record' })");
    expect(source).toContain("t('usage.deleteDialog.message', { defaultValue: 'Are you sure you want to delete this usage record? This action cannot be undone.' })");
    expect(source).toContain("t('usage.toast.createSuccess', { defaultValue: 'Usage record created successfully' })");
    expect(source).toContain("t('usage.toast.updateSuccess', { defaultValue: 'Usage record updated successfully' })");
    expect(source).toContain("t('usage.toast.deleteSuccess', { defaultValue: 'Usage record deleted successfully' })");
    expect(source).toContain("t('usage.toast.createError', { defaultValue: 'Failed to create usage record' })");
    expect(source).toContain("t('usage.toast.updateError', { defaultValue: 'Failed to update usage record' })");
    expect(source).toContain("t('usage.toast.deleteError', { defaultValue: 'Failed to delete usage record' })");
  });

  it('T014: wires the contract line selector guidance text through msp/billing translations with interpolation', () => {
    const source = read('../../src/components/billing-dashboard/UsageTracking.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain("t('usage.contractLineGuidance.multipleLines', { defaultValue: 'This service appears in multiple contract lines. Please select which contract line to bill against.' })");
    expect(source).toContain("t('usage.contractLineGuidance.tooltipNoClient', { defaultValue: 'Client information not available. Usage will route to the system-managed default contract.' })");
    expect(source).toContain("t('usage.contractLineGuidance.tooltipMultiple', { defaultValue: 'This service appears in multiple contract lines. Please select which contract line to use. Bucket contract lines are typically used first until depleted.' })");
    expect(source).toContain("t('usage.contractLineGuidance.tooltipSingle', { defaultValue: 'This usage will be billed under the \"{{name}}\" contract line.', name: eligibleContractLines[0].contract_line_name })");
    expect(source).toContain("t('usage.contractLineGuidance.tooltipNone', { defaultValue: 'No eligible contract lines found for this service.' })");
    expect(source).toContain("t('usage.contractLineGuidance.wrongContractLineWarning', { defaultValue: 'Selecting the wrong contract line may result in incorrect billing' })");

    const pseudoKeys = [
      'usage.bucketHoursOverview',
      'usage.usageRecords',
      'usage.table.client',
      'usage.table.service',
      'usage.dialog.editTitle',
      'usage.dialog.addTitle',
      'usage.contractLineGuidance.multipleLines',
      'usage.contractLineGuidance.wrongContractLineWarning',
      'usage.deleteDialog.title',
      'usage.toast.createSuccess',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});
