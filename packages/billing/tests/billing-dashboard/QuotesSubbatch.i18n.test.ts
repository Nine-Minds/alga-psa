// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'),
  ) as T;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('Quotes i18n wiring contract', () => {
  it('T001: english quotes namespace exposes the planned top-level groups', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(Object.keys(en)).toEqual([
      'common',
      'quotesTab',
      'quoteForm',
      'quoteDetail',
      'quoteLineItems',
      'quoteRecipients',
      'quoteConversion',
      'quoteApproval',
      'quoteTemplates',
      'quotePreview',
      'templateEditor',
      'templatesPage',
    ]);
  });

  it('T003: QuoteForm uses msp/quotes translation keys for form chrome, workflow actions, and dialogs', () => {
    const source = read('../../src/components/billing-dashboard/quotes/QuoteForm.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../../server/public/locales/en/msp/quotes.json',
    );

    expect(source).toContain("import { useTranslation } from '@alga-psa/ui/lib/i18n/client';");
    expect(source).toContain("const { t } = useTranslation('msp/quotes');");

    const keyChecks = [
      'quoteForm.headings.editQuote',
      'quoteForm.headings.newTemplate',
      'common.actions.submitForApproval',
      'quoteForm.actions.cancelQuote',
      'quoteForm.actions.convertToBoth',
      'quoteForm.fields.createFromTemplate',
      'quoteForm.fields.recipients',
      'quoteForm.dialogs.send.title',
      'quoteForm.dialogs.approval.approveTitle',
      'quoteForm.dialogs.conversion.title',
      'quoteForm.notices.sent',
      'quoteForm.errors.save',
      'quoteForm.validation.clientRequired',
      'common.labels.quoteLayout',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
