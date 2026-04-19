// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'),
  ) as T;
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
});
