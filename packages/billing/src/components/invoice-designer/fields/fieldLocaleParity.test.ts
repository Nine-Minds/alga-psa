import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getTemplateFieldDefinition } from './fieldCatalog';

// The designer FIELDS panel (ComponentPalette) renders t('designer.fields.<path with . -> _>.label|description')
// from msp/invoicing and only falls back to fieldCatalog.ts. A stale locale string therefore
// silently overrides a correct catalog entry (alga0002295: Subtotal said "before tax and discounts").

const LOCALES_DIR = path.resolve(__dirname, '../../../../../../server/public/locales');
const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv', 'xx', 'yy'];

type FieldCopy = { label?: string; description?: string };

const loadFields = (locale: string): Record<string, FieldCopy> =>
  JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, 'msp/invoicing.json'), 'utf8')).designer.fields;

const en = loadFields('en');

describe('designer.fields locale copy matches fieldCatalog', () => {
  it('keeps the en subtotal description in step with the catalog and free of the old wording', () => {
    const description = en.invoice_subtotal.description ?? '';
    expect(description).not.toContain('before tax and discounts');
    expect(description).toBe(getTemplateFieldDefinition('invoice.subtotal')?.description);
  });

  it('en label and description equal the catalog for every key that maps to a catalog entry', () => {
    const checked: string[] = [];
    for (const [key, copy] of Object.entries(en)) {
      const definition = getTemplateFieldDefinition(key.replace(/_/g, '.'));
      if (!definition) continue;
      checked.push(key);
      expect({ key, ...copy }).toEqual({ key, label: definition.label, description: definition.description });
    }
    expect(checked).toEqual(expect.arrayContaining(['invoice_subtotal', 'invoice_discountTotal', 'invoice_grossSubtotal']));
  });

  it.each(LOCALES)('%s has label and description for the discount and gross subtotal fields', (locale) => {
    const fields = loadFields(locale);
    for (const key of ['invoice_discountTotal', 'invoice_grossSubtotal']) {
      expect(fields[key]?.label, `${locale}:${key}.label`).toBeTruthy();
      expect(fields[key]?.description, `${locale}:${key}.description`).toBeTruthy();
    }
    expect(fields.invoice_discount).toBeUndefined();
  });
});
