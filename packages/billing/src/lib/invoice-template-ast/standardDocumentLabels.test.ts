import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_DOCUMENT_LABELS, findStandardDocumentLabelByText } from './standardDocumentLabels';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('STANDARD_DOCUMENT_LABELS', () => {
  it('lists exactly the top-level English document labels, with their English text', () => {
    const english = JSON.parse(
      readFileSync(path.resolve(repoRoot, 'server/public/locales/en/documents.json'), 'utf8')
    ) as { labels: Record<string, unknown> };
    const expected = Object.entries(english.labels)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => ({ i18nKey: `labels.${key}`, defaultValue: value }));

    expect([...STANDARD_DOCUMENT_LABELS]).toEqual(expected);
  });

  it('finds a standard label by its exact English text', () => {
    expect(findStandardDocumentLabelByText('Subtotal')).toEqual({ i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' });
    expect(findStandardDocumentLabelByText('Invoice #')?.i18nKey).toBe('labels.invoiceNumber');
    expect(findStandardDocumentLabelByText('My own heading')).toBeUndefined();
  });
});
