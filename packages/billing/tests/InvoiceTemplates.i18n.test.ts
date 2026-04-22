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

describe('InvoiceTemplates i18n wiring contract', () => {
  it('T027: title, columns, type labels, loading state, and create action resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/InvoiceTemplates.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'templates.title',
      'templates.columns.templateName',
      'templates.columns.type',
      'templates.columns.default',
      'templates.columns.actions',
      'templates.types.standard',
      'templates.types.custom',
      'templates.loading',
      'templates.actions.create',
      'templates.values.standardSuffix',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T028: menu actions, open-menu label, generated clone names, and list-action errors resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/InvoiceTemplates.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'templates.actions.edit',
      'templates.actions.editAsCopy',
      'templates.actions.clone',
      'templates.actions.setDefault',
      'templates.actions.delete',
      'templates.actions.openMenu',
      'templates.values.thisTemplate',
      'templates.values.copySuffix',
      'templates.values.copyOfName',
      'templates.errors.cloneFailed',
      'templates.errors.cloneEditFailed',
      'templates.errors.setDefaultFailed',
      'templates.errors.fetchFailed',
      'templates.errors.deleteValidationFailed',
      'templates.errors.deleteUnexpected',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
