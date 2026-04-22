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

describe('ExternalTaxImportPanel i18n wiring contract', () => {
  it('T031: panel title, pending/imported alerts, import action, reconciliation labels, and adapter labels resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/ExternalTaxImportPanel.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const sourceKeyChecks = [
      'externalTax.title',
      'externalTax.actions.showHistory',
      'externalTax.actions.hideHistory',
      'externalTax.actions.importing',
      'externalTax.actions.importFromAdapter',
      'externalTax.alerts.pendingTitle',
      'externalTax.alerts.pendingDescription',
      'externalTax.alerts.importedTitle',
      'externalTax.reconciliation.internal',
      'externalTax.reconciliation.external',
      'externalTax.reconciliation.difference',
      'externalTax.adapterNames.${adapterKey}',
      'externalTax.values.externalSystem',
    ];

    const localeKeyChecks = [
      'externalTax.title',
      'externalTax.actions.showHistory',
      'externalTax.actions.hideHistory',
      'externalTax.actions.importing',
      'externalTax.actions.importFromAdapter',
      'externalTax.alerts.pendingTitle',
      'externalTax.alerts.pendingDescription',
      'externalTax.alerts.importedTitle',
      'externalTax.reconciliation.internal',
      'externalTax.reconciliation.external',
      'externalTax.reconciliation.difference',
      'externalTax.adapterNames.quickbooks',
      'externalTax.adapterNames.xero',
      'externalTax.adapterNames.sage',
      'externalTax.values.externalSystem',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of sourceKeyChecks) {
      expect(source).toContain(key);
    }

    for (const key of localeKeyChecks) {
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T032: history, significant-difference warning, tooltip, help text, and import-result toasts/errors resolve through msp/invoicing', () => {
    const source = read('../src/components/invoices/ExternalTaxImportPanel.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'externalTax.reconciliation.history',
      'externalTax.states.loadingHistory',
      'externalTax.empty.history',
      'externalTax.alerts.significantDifferenceTitle',
      'externalTax.alerts.significantDifferenceDescription',
      'externalTax.tooltips.externalRef',
      'externalTax.values.notAvailable',
      'externalTax.helpText',
      'externalTax.toasts.taxImportedFromAdapter',
      'externalTax.toasts.taxImportFailed',
      'externalTax.errors.importTaxFailed',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
