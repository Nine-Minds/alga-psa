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

describe('FinalizedTab i18n wiring contract', () => {
  it('T016: table headers, finalized badge, search placeholder, row actions, loading state, and error keys resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/FinalizedTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'finalizedTab.searchPlaceholder',
      'finalizedTab.columns.invoiceNumber',
      'finalizedTab.columns.client',
      'finalizedTab.columns.amount',
      'finalizedTab.columns.finalizedDate',
      'finalizedTab.columns.status',
      'finalizedTab.columns.actions',
      'finalizedTab.status.finalized',
      'finalizedTab.actions.downloadPdf',
      'finalizedTab.actions.sendEmail',
      'finalizedTab.actions.recordPayment',
      'finalizedTab.actions.unfinalize',
      'finalizedTab.loading',
      'finalizedTab.errors.loadFailed',
      'finalizedTab.errors.pdfFailed',
      'finalizedTab.errors.bulkPdfFailed',
      'finalizedTab.errors.bulkUnfinalizeInvoiceFailed',
      'common.actions.openMenu',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T017: empty state, bulk actions, and view-drafts CTA resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/FinalizedTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'finalizedTab.bulk.actionBar.selectedCount',
      'finalizedTab.bulk.actionBar.clear',
      'finalizedTab.actions.downloadPdfs',
      'finalizedTab.actions.sendEmails',
      'finalizedTab.actions.unfinalizeSelected',
      'finalizedTab.empty.title',
      'finalizedTab.empty.description',
      'finalizedTab.empty.viewDrafts',
    ];
    const localeKeyChecks = [
      'finalizedTab.bulk.actionBar.selectedCount',
      'finalizedTab.bulk.actionBar.clear',
      'finalizedTab.actions.downloadPdfs',
      'finalizedTab.actions.sendEmails',
      'finalizedTab.actions.unfinalizeSelected',
      'finalizedTab.empty.title',
      'finalizedTab.empty.description',
      'finalizedTab.empty.viewDrafts',
    ];

    expect(source).toContain("t('finalizedTab.bulk.actionBar.selectedCount'");

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T018: the Record Payment row action and dialog resolve through msp/invoicing', () => {
    const tab = read('../src/components/billing-dashboard/invoicing/FinalizedTab.tsx');
    const dialog = read('../src/components/billing-dashboard/invoicing/RecordPaymentDialog.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    expect(tab).toContain('finalizedTab.actions.recordPayment');
    expect(dialog).toContain("useTranslation('msp/invoicing')");

    const dialogKeyChecks = [
      'recordPayment.title',
      'recordPayment.titleForInvoice',
      'recordPayment.loading',
      'recordPayment.summary.balanceDue',
      'recordPayment.summary.alreadyPaid',
      'recordPayment.fields.amount',
      'recordPayment.fields.paymentDate',
      'recordPayment.fields.method',
      'recordPayment.fields.reference',
      'recordPayment.fields.notes',
      'recordPayment.placeholders.reference',
      'recordPayment.overpayment.warning',
      'recordPayment.overpayment.confirm',
      'recordPayment.actions.cancel',
      'recordPayment.actions.record',
      'recordPayment.toasts.recorded',
    ];

    for (const key of dialogKeyChecks) {
      expect(dialog).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }

    // Method labels are keyed off the shared method list, so only the prefix is literal.
    expect(dialog).toContain('recordPayment.methods.');
    for (const method of ['manual', 'check', 'bank_transfer', 'cash', 'other']) {
      expect(getLeaf(en, `recordPayment.methods.${method}`)).toBeDefined();
    }

    // Every action refusal carries a localized key, not raw English.
    for (const key of [
      'errors.recordPayment.permissionDenied',
      'errors.recordPayment.invoiceNotFound',
      'errors.recordPayment.amountPositive',
      'errors.recordPayment.methodRequired',
      'errors.recordPayment.invalidDate',
      'errors.recordPayment.noBalanceDue',
      'errors.recordPayment.statusNotPayable',
      'errors.recordPayment.overpaymentNotConfirmed',
      'errors.recordPayment.recordFailed',
    ]) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
