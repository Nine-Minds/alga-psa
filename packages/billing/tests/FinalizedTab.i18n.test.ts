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
      'finalizedTab.actions.unfinalize',
      'finalizedTab.loading',
      'finalizedTab.errors.loadFailed',
      'finalizedTab.errors.pdfFailed',
      'finalizedTab.errors.unfinalizeFailed',
      'finalizedTab.errors.bulkPdfFailed',
      'finalizedTab.errors.bulkUnfinalizeFailed',
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
      'finalizedTab.bulkActions',
      'finalizedTab.actions.downloadPdfs',
      'finalizedTab.actions.sendEmails',
      'finalizedTab.actions.unfinalizeSelected',
      'finalizedTab.empty.title',
      'finalizedTab.empty.description',
      'finalizedTab.empty.viewDrafts',
    ];
    const localeKeyChecks = [
      'finalizedTab.bulkActions_one',
      'finalizedTab.bulkActions_other',
      'finalizedTab.actions.downloadPdfs',
      'finalizedTab.actions.sendEmails',
      'finalizedTab.actions.unfinalizeSelected',
      'finalizedTab.empty.title',
      'finalizedTab.empty.description',
      'finalizedTab.empty.viewDrafts',
    ];

    expect(source).toContain("t('finalizedTab.bulkActions'");

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
