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

describe('AutomaticInvoices i18n wiring contract', () => {
  it('T003: ready-to-invoice chrome uses msp/invoicing keys for title, descriptions, filters, and table headers', () => {
    const source = read('../src/components/billing-dashboard/AutomaticInvoices.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    expect(source).toContain("const { t } = useTranslation('msp/invoicing');");

    const keyChecks = [
      'automaticInvoices.ready.title',
      'automaticInvoices.ready.description',
      'automaticInvoices.ready.selectAllExplanation',
      'automaticInvoices.ready.dateRange',
      'automaticInvoices.ready.search',
      'automaticInvoices.ready.filterPlaceholder',
      'automaticInvoices.ready.columns.group',
      'automaticInvoices.ready.columns.servicePeriod',
      'automaticInvoices.ready.columns.invoiceWindow',
      'automaticInvoices.ready.columns.included',
      'automaticInvoices.actions.previewSelected',
      'automaticInvoices.actions.generateSelected',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(`t('${key}'`);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
