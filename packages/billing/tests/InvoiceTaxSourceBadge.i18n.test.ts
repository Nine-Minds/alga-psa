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

describe('InvoiceTaxSourceBadge i18n wiring contract', () => {
  it('T042: badge labels, tooltips, adapter names, and imported date tooltip pattern resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/InvoiceTaxSourceBadge.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    expect(source).toContain("const { t } = useTranslation('msp/invoicing');");
    expect(source).toContain('const { formatDate } = useFormatters();');
    expect(source).toContain("t(`taxBadge.labels.${config.labelKey}`");
    expect(source).toContain("t(`taxBadge.tooltips.${config.tooltipKey}`");
    expect(source).toContain("t('taxBadge.tooltips.externalAdapter'");
    expect(source).toContain("t('taxBadge.tooltips.externalAdapterImportedAt'");
    expect(source).toContain("t('taxBadge.tooltips.pendingAdapter'");
    expect(source).toContain("t(`taxBadge.adapterNames.${adapterKey}`");

    const keyChecks = [
      'taxBadge.labels.internal',
      'taxBadge.labels.external',
      'taxBadge.labels.pending',
      'taxBadge.tooltips.internal',
      'taxBadge.tooltips.external',
      'taxBadge.tooltips.pending',
      'taxBadge.tooltips.externalAdapter',
      'taxBadge.tooltips.externalAdapterImportedAt',
      'taxBadge.tooltips.pendingAdapter',
      'taxBadge.adapterNames.quickbooks',
      'taxBadge.adapterNames.xero',
      'taxBadge.adapterNames.sage',
    ];

    for (const key of keyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
