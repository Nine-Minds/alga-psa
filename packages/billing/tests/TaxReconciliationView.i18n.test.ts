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

describe('TaxReconciliationView i18n wiring contract', () => {
  it('T035: card title, comparison labels, table headers, and total label resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/TaxReconciliationView.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'externalTax.reconciliationView.title',
      'externalTax.reconciliationView.summary.internal',
      'externalTax.reconciliationView.summary.external',
      'externalTax.reconciliationView.columns.description',
      'externalTax.reconciliationView.columns.internalTax',
      'externalTax.reconciliationView.columns.externalTax',
      'externalTax.reconciliationView.columns.difference',
      'externalTax.reconciliationView.labels.total',
      'externalTax.reconciliationView.labels.line',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T036: warning, loading/no-data states, tooltips, description, section heading, and help text resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/TaxReconciliationView.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'externalTax.reconciliationView.description',
      'externalTax.reconciliationView.tooltips.significantDifference',
      'externalTax.reconciliationView.tooltips.amountsMatch',
      'externalTax.reconciliationView.alerts.significantDifferenceTitle',
      'externalTax.reconciliationView.alerts.significantDifferenceDescription',
      'externalTax.reconciliationView.sections.lineByLineBreakdown',
      'externalTax.reconciliationView.states.loading',
      'externalTax.reconciliationView.states.noData',
      'externalTax.reconciliationView.helpText',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
