// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8'),
  ) as T;
}

function getLeaf(record: Record<string, unknown>, dottedPath: string): unknown {
  return dottedPath.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[key];
  }, record);
}

describe('Invoicing locale smoke', () => {
  it('T002: English invoicing namespace exposes the expected top-level groups', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );

    expect(Object.keys(en)).toEqual([
      'automaticInvoices',
      'manualInvoices',
      'draftsTab',
      'finalizedTab',
      'recurringServicePeriods',
      'billingCycles',
      'invoicePreview',
      'templateEditor',
      'templates',
      'externalTax',
      'sendEmail',
      'generateTab',
      'prepayment',
      'contractItems',
      'hub',
      'templateManager',
      'taxBadge',
      'annotations',
      'purchaseOrder',
      'common',
    ]);
  });

  it('T048: xx pseudo-locale covers representative invoicing hub/generate/drafts/finalized chrome with fill markers instead of English', () => {
    const xx = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/invoicing.json',
    );

    const pseudoKeys = [
      'hub.title',
      'hub.tabs.generate',
      'hub.tabs.drafts',
      'hub.tabs.finalized',
      'generateTab.fields.invoiceType',
      'generateTab.types.automatic',
      'draftsTab.empty.title',
      'draftsTab.empty.description',
      'finalizedTab.empty.title',
      'finalizedTab.empty.viewDrafts',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(xx, key)).toBe('11111');
    }
  });

  it('T049: xx pseudo-locale covers representative template list/editor/manager chrome with fill markers instead of English', () => {
    const xx = readJson<Record<string, unknown>>(
      '../../../server/public/locales/xx/msp/invoicing.json',
    );

    const pseudoKeys = [
      'templates.title',
      'templates.actions.create',
      'templateEditor.titles.create',
      'templateEditor.tabs.visual',
      'templateEditor.actions.save',
      'templateManager.title',
      'templateManager.templatePreview',
    ];

    for (const key of pseudoKeys) {
      expect(getLeaf(xx, key)).toBe('11111');
    }
  });

  it('T050: de locale exposes translated billing cycles chrome, anchor labels, and month names', () => {
    const en = readJson<Record<string, unknown>>(
      '../../../server/public/locales/en/msp/invoicing.json',
    );
    const de = readJson<Record<string, unknown>>(
      '../../../server/public/locales/de/msp/invoicing.json',
    );

    const translatedKeys = [
      'billingCycles.title',
      'billingCycles.columns.client',
      'billingCycles.columns.contract',
      'billingCycles.columns.anchor',
      'billingCycles.actions.viewClientBilling',
      'billingCycles.months.january',
      'billingCycles.months.february',
      'billingCycles.values.weekday',
      'billingCycles.values.rolling',
      'billingCycles.values.starts',
    ];

    for (const key of translatedKeys) {
      const english = getLeaf(en, key);
      const german = getLeaf(de, key);
      expect(german).toBeDefined();
      expect(german).not.toBe(english);
    }

    expect(getLeaf(de, 'billingCycles.values.monthDay')).toBe('{{month}} {{day}}');
  });
});
