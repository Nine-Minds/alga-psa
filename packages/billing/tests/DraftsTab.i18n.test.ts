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

describe('DraftsTab i18n wiring contract', () => {
  it('T014: table headers, draft badge, search placeholder, row actions, loading state, and error keys resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/DraftsTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'draftsTab.searchPlaceholder',
      'draftsTab.columns.invoiceNumber',
      'draftsTab.columns.client',
      'draftsTab.columns.amount',
      'draftsTab.columns.invoiceDate',
      'draftsTab.columns.dueDate',
      'draftsTab.columns.status',
      'draftsTab.columns.actions',
      'draftsTab.status.draft',
      'draftsTab.actions.finalize',
      'draftsTab.actions.downloadPdf',
      'draftsTab.actions.reverseDraft',
      'draftsTab.loading',
      'draftsTab.errors.loadFailed',
      'draftsTab.errors.finalizeFailed',
      'draftsTab.errors.bulkFinalizeFailed',
      'draftsTab.errors.pdfFailed',
      'draftsTab.errors.reverseFailed',
      'common.actions.openMenu',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T015: empty state, bulk actions, and reverse confirmation dialog resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/invoicing/DraftsTab.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'draftsTab.bulkActions',
      'draftsTab.actions.finalizeSelected',
      'draftsTab.actions.reverseSelected',
      'draftsTab.empty.title',
      'draftsTab.empty.description',
      'draftsTab.actions.generateInvoices',
      'draftsTab.reverseDialog.title',
      'draftsTab.reverseDialog.message',
      'draftsTab.reverseDialog.confirm',
      'draftsTab.reverseDialog.cancel',
    ];
    const localeKeyChecks = [
      'draftsTab.bulkActions_one',
      'draftsTab.bulkActions_other',
      'draftsTab.actions.finalizeSelected',
      'draftsTab.actions.reverseSelected',
      'draftsTab.empty.title',
      'draftsTab.empty.description',
      'draftsTab.actions.generateInvoices',
      'draftsTab.reverseDialog.title',
      'draftsTab.reverseDialog.title_other',
      'draftsTab.reverseDialog.message_one',
      'draftsTab.reverseDialog.message_other',
      'draftsTab.reverseDialog.confirm',
      'draftsTab.reverseDialog.cancel',
    ];

    expect(source).toContain("t('draftsTab.bulkActions'");
    expect(source).toContain("t('draftsTab.reverseDialog.title'");
    expect(source).toContain("t('draftsTab.reverseDialog.message'");

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
