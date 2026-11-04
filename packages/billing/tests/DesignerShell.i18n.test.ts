// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const TRANSLATED_LOCALES = ['en', 'de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv'];

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(read(`../../../server/public/locales/${locale}/msp/invoicing.json`)) as Record<string, unknown>;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('DesignerShell i18n wiring contract', () => {
  const source = read('../src/components/invoice-designer/DesignerShell.tsx');
  const designerKeys = Array.from(
    new Set(Array.from(source.matchAll(/\bt\(\s*'(designer\.[A-Za-z0-9_.]+)'/g), (match) => match[1])),
  );

  it('finds the barcode inspector and custom page size keys in the component', () => {
    expect(designerKeys).toEqual(
      expect.arrayContaining([
        'designer.inspector.barcode',
        'designer.inspector.barcodeSymbology',
        'designer.inspector.barcodeQr',
        'designer.inspector.barcodeCode128',
        'designer.inspector.barcodeValue',
        'designer.inspector.barcodeHint',
        'designer.inspector.barcodeHintWorkTag',
        'designer.pageSetup.customSize',
        'designer.pageSetup.customWidth',
        'designer.pageSetup.customHeight',
        'designer.pageSetup.customUnit',
      ]),
    );
  });

  it.each(TRANSLATED_LOCALES)('every designer key used by DesignerShell resolves to a string in %s', (locale) => {
    const pack = readLocale(locale);
    const missing = designerKeys.filter((key) => typeof getLeaf(pack, key) !== 'string');
    expect(missing).toEqual([]);
  });

  it.each(TRANSLATED_LOCALES)('the work-tag barcode hint keeps its {{example}} placeholder in %s', (locale) => {
    expect(getLeaf(readLocale(locale), 'designer.inspector.barcodeHintWorkTag')).toContain('{{example}}');
  });
});
