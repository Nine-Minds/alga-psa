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

describe('InvoiceTemplateEditor i18n wiring contract', () => {
  it('T025: back nav, heading variants, field labels, tabs, readonly alert, and footer actions resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/InvoiceTemplateEditor.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'templateEditor.actions.back',
      'templateEditor.actions.cancel',
      'templateEditor.actions.save',
      'templateEditor.actions.saving',
      'templateEditor.titles.create',
      'templateEditor.titles.edit',
      'templateEditor.fields.templateName',
      'templateEditor.fields.templateAst',
      'templateEditor.tabs.visual',
      'templateEditor.tabs.code',
      'templateEditor.alerts.codeReadonly',
    ];

    expect(source).toContain("useTranslation('msp/invoicing')");
    expect(source).toContain('useFormatters()');

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });

  it('T026: validation, timestamp labels, and AST export/save errors resolve through msp/invoicing', () => {
    const source = read('../src/components/billing-dashboard/InvoiceTemplateEditor.tsx');
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    const keyChecks = [
      'templateEditor.fields.created',
      'templateEditor.fields.lastUpdated',
      'templateEditor.errors.loadFailed',
      'templateEditor.errors.saveFailed',
      'templateEditor.errors.unexpectedSave',
      'templateEditor.errors.templateNameRequired',
      'templateEditor.errors.astExportFailed',
      'templateEditor.errors.unknownAstExport',
    ];

    for (const key of keyChecks) {
      expect(source).toContain(key);
      expect(getLeaf(en, key)).toBeDefined();
    }
  });
});
