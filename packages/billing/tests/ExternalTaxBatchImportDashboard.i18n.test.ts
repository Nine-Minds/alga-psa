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

describe('ExternalTaxBatchImportDashboard i18n wiring contract', () => {
  it('T029: card chrome, table columns, adapter labels, and import actions resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/ExternalTaxBatchImportDashboard.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'externalTax.title',
      'externalTax.description',
      'externalTax.columns.invoice',
      'externalTax.columns.client',
      'externalTax.columns.amount',
      'externalTax.columns.system',
      'externalTax.columns.created',
      'externalTax.columns.actions',
      'externalTax.actions.import',
      'externalTax.actions.refresh',
      'externalTax.actions.importAll',
      'externalTax.adapterNames.${adapterKey}',
      'externalTax.values.unknownSystem',
    ];

    const localeKeyChecks = [
      'externalTax.title',
      'externalTax.description',
      'externalTax.columns.invoice',
      'externalTax.columns.client',
      'externalTax.columns.amount',
      'externalTax.columns.system',
      'externalTax.columns.created',
      'externalTax.columns.actions',
      'externalTax.actions.import',
      'externalTax.actions.refresh',
      'externalTax.actions.importAll',
      'externalTax.adapterNames.quickbooks',
      'externalTax.adapterNames.xero',
      'externalTax.adapterNames.sage',
      'externalTax.values.unknownSystem',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T030: batch progress, results summary, empty state, help text, and toast/error copy resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/ExternalTaxBatchImportDashboard.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'externalTax.summary.pending',
      'externalTax.summary.successful',
      'externalTax.summary.failed',
      'externalTax.progress.importing',
      'externalTax.progress.importingCount',
      'externalTax.empty.allUpToDate',
      'externalTax.empty.nonePending',
      'externalTax.helpText',
      'externalTax.toasts.noPendingInvoices',
      'externalTax.toasts.batchImportedSuccess',
      'externalTax.toasts.batchImportedPartial',
      'externalTax.toasts.batchImportedFailed',
      'externalTax.toasts.taxImportedSuccessfully',
      'externalTax.toasts.taxImportFailed',
      'externalTax.errors.loadPendingInvoices',
      'externalTax.errors.batchImportFailed',
      'externalTax.errors.importFailed',
    ];

    const localeKeyChecks = [
      'externalTax.summary.pending_one',
      'externalTax.summary.pending_other',
      'externalTax.summary.successful_one',
      'externalTax.summary.successful_other',
      'externalTax.summary.failed_one',
      'externalTax.summary.failed_other',
      'externalTax.progress.importing',
      'externalTax.progress.importingCount',
      'externalTax.empty.allUpToDate',
      'externalTax.empty.nonePending',
      'externalTax.helpText',
      'externalTax.toasts.noPendingInvoices',
      'externalTax.toasts.batchImportedSuccess_one',
      'externalTax.toasts.batchImportedSuccess_other',
      'externalTax.toasts.batchImportedPartial',
      'externalTax.toasts.batchImportedFailed_one',
      'externalTax.toasts.batchImportedFailed_other',
      'externalTax.toasts.taxImportedSuccessfully',
      'externalTax.toasts.taxImportFailed',
      'externalTax.errors.loadPendingInvoices',
      'externalTax.errors.batchImportFailed',
      'externalTax.errors.importFailed',
    ];

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
