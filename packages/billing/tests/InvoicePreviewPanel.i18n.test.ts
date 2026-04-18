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

describe('InvoicePreviewPanel i18n wiring contract', () => {
  it('T023: panel heading, action buttons, template picker, and source-quote action resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'invoicePreview.title',
      'invoicePreview.templatePlaceholder',
      'invoicePreview.labels.standard',
      'invoicePreview.actions.finalizeInvoice',
      'invoicePreview.actions.editItems',
      'invoicePreview.actions.downloadPdf',
      'invoicePreview.actions.reverseDraft',
      'invoicePreview.actions.sendEmail',
      'invoicePreview.actions.unfinalize',
      'invoicePreview.actions.viewSourceQuote',
      'invoicePreview.errors.actionLabels.finalizeInvoice',
      'invoicePreview.errors.actionLabels.downloadPdf',
      'invoicePreview.errors.actionLabels.reverseDraft',
      'invoicePreview.errors.actionLabels.sendEmail',
      'invoicePreview.errors.actionLabels.unfinalize',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T024: empty state, loading state, error fallback, and preview error alerts resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/InvoicePreviewPanel.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'invoicePreview.loading',
      'invoicePreview.empty',
      'invoicePreview.errorDescription',
      'invoicePreview.errors.loadFailed',
      'invoicePreview.errors.actionFailed',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
