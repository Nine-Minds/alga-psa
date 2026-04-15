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

describe('AccountingExportsTab i18n wiring contract', () => {
  it('T019: wires the card title, batch table headers, and action buttons through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/accounting/AccountingExportsTab.tsx');

    expect(source).toContain("const { t } = useTranslation('msp/billing');");
    expect(source).toContain("t('accountingExports.title', { defaultValue: 'Accounting Exports' })");
    expect(source).toContain("t('accountingExports.table.batch', { defaultValue: 'Batch' })");
    expect(source).toContain("t('accountingExports.table.adapter', { defaultValue: 'Adapter' })");
    expect(source).toContain("t('accountingExports.table.status', { defaultValue: 'Status' })");
    expect(source).toContain("t('accountingExports.table.created', { defaultValue: 'Created' })");
    expect(source).toContain("t('accountingExports.table.updated', { defaultValue: 'Updated' })");
    expect(source).toContain("t('accountingExports.table.actions', { defaultValue: 'Actions' })");
    expect(source).toContain("t('accountingExports.actions.refresh', { defaultValue: 'Refresh' })");
    expect(source).toContain("t('accountingExports.actions.newExport', { defaultValue: 'New Export' })");
    expect(source).toContain("t('accountingExports.actions.open', { defaultValue: 'Open' })");
    expect(source).toContain("t('accountingExports.actions.execute', { defaultValue: 'Execute' })");
    expect(source).toContain("t('accountingExports.states.loadingBatches', { defaultValue: 'Loading batches...' })");
    expect(source).toContain("t('accountingExports.states.empty', { defaultValue: 'No export batches yet.' })");
  });

  it('T020: wires the new-export dialog labels and batch-detail dialog labels through msp/billing translations', () => {
    const source = read('../../src/components/billing-dashboard/accounting/AccountingExportsTab.tsx');

    expect(source).toContain("t('accountingExports.createDialog.title', { defaultValue: 'New Accounting Export' })");
    expect(source).toContain("t('accountingExports.createDialog.fields.adapter', { defaultValue: 'Adapter' })");
    expect(source).toContain("t('accountingExports.createDialog.fields.startDate', { defaultValue: 'Start Date' })");
    expect(source).toContain("t('accountingExports.createDialog.fields.endDate', { defaultValue: 'End Date' })");
    expect(source).toContain("t('accountingExports.createDialog.fields.clientSearch', { defaultValue: 'Client Search' })");
    expect(source).toContain("t('accountingExports.createDialog.fields.invoiceStatuses', { defaultValue: 'Invoice Statuses' })");
    expect(source).toContain("t('accountingExports.createDialog.fields.notes', { defaultValue: 'Notes' })");
    expect(source).toContain("t('accountingExports.actions.creating', { defaultValue: 'Creating...' })");
    expect(source).toContain("t('accountingExports.actions.createBatch', { defaultValue: 'Create Batch' })");
    expect(source).toContain("t('accountingExports.detailDialog.title', { defaultValue: 'Accounting Export Batch' })");
    expect(source).toContain("t('accountingExports.detailDialog.subtitle', { defaultValue: 'Batch Details' })");
    expect(source).toContain("t('accountingExports.detailDialog.fields.batchId', { defaultValue: 'Batch ID' })");
    expect(source).toContain("t('accountingExports.detailDialog.fields.adapter', { defaultValue: 'Adapter' })");
    expect(source).toContain("t('accountingExports.detailDialog.fields.lines', { defaultValue: 'Lines' })");
    expect(source).toContain("t('accountingExports.detailDialog.fields.errors', { defaultValue: 'Errors' })");
    expect(source).toContain("t('accountingExports.detailDialog.fields.delivered', { defaultValue: 'Delivered' })");
    expect(source).toContain("t('accountingExports.states.loadingDetails', { defaultValue: 'Loading batch details...' })");
    expect(source).toContain("t('accountingExports.states.batchNotFound', { defaultValue: 'Batch not found.' })");
  });

  it('T020A: maps backend status codes through accountingExports.status.* keys instead of rendering raw codes', () => {
    const source = read('../../src/components/billing-dashboard/accounting/AccountingExportsTab.tsx');
    const pseudo = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/xx/msp/billing.json'
    );

    expect(source).toContain('getAccountingExportStatusKey');
    expect(source).toContain("t(`accountingExports.status.${getAccountingExportStatusKey(status)}`");

    const statusKeys = [
      'accountingExports.status.pending',
      'accountingExports.status.validating',
      'accountingExports.status.ready',
      'accountingExports.status.delivered',
      'accountingExports.status.posted',
      'accountingExports.status.failed',
      'accountingExports.status.cancelled',
      'accountingExports.status.needsAttention',
    ];

    for (const key of statusKeys) {
      expect(getLeaf(pseudo, key)).toBe('11111');
    }
  });
});
