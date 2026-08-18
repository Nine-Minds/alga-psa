import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TemplateAst, TemplateI18nText } from '@alga-psa/types';

import { isTemplateI18nRef } from '../invoice-template-ast/i18nLabels';
import { STANDARD_INVOICE_TEMPLATE_ASTS } from '../invoice-template-ast/standardTemplates';
import { STANDARD_QUOTE_TEMPLATE_ASTS } from '../quote-template-ast/standardTemplates';
import { STANDARD_SALES_ORDER_TEMPLATE_ASTS } from '../sales-order-template-ast/standardTemplates';
import {
  STANDARD_PACKING_SLIP_TEMPLATE_ASTS,
  STANDARD_PICK_LIST_TEMPLATE_ASTS,
} from '../sales-order-template-ast/otherDocuments';

const MANIFEST_PATH = path.resolve(__dirname, 'standardTemplateI18n.manifest.json');

const FAMILIES: Array<{ family: string; catalog: Record<string, TemplateAst> }> = [
  { family: 'invoice', catalog: STANDARD_INVOICE_TEMPLATE_ASTS as Record<string, TemplateAst> },
  { family: 'quote', catalog: STANDARD_QUOTE_TEMPLATE_ASTS },
  { family: 'sales-order', catalog: STANDARD_SALES_ORDER_TEMPLATE_ASTS },
  { family: 'packing-slip', catalog: STANDARD_PACKING_SLIP_TEMPLATE_ASTS },
  { family: 'pick-list', catalog: STANDARD_PICK_LIST_TEMPLATE_ASTS },
];

// Display strings the templates deliberately keep as literals: an image alt that
// is never shown, and the pick list's empty check box glyph.
const LITERAL_ALLOWLIST = new Set(['logo', '☐']);

const englishKeys = (() => {
  const localesDir = process.env.I18N_LOCALES_DIR
    ? path.resolve(process.env.I18N_LOCALES_DIR)
    : path.resolve(__dirname, '../../../../../server/public/locales');
  const raw = JSON.parse(fs.readFileSync(path.join(localesDir, 'en', 'documents.json'), 'utf8'));
  const keys = new Set<string>();
  const walk = (node: unknown, prefix: string) => {
    if (typeof node !== 'object' || node === null) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') keys.add(full);
      else walk(value, full);
    }
  };
  walk(raw, '');
  return keys;
})();

type LabelSite = { path: string; value: TemplateI18nText };

const collectLabelSites = (node: any, at: string, out: LabelSite[] = []): LabelSite[] => {
  if (!node || typeof node !== 'object') return out;

  if (node.type === 'section' && node.title !== undefined) out.push({ path: `${at}.title`, value: node.title });
  if (node.type === 'field' && node.label !== undefined) out.push({ path: `${at}.label`, value: node.label });
  if (node.type === 'table' || node.type === 'dynamic-table') {
    if (node.emptyStateText !== undefined) out.push({ path: `${at}.emptyStateText`, value: node.emptyStateText });
    (node.columns ?? []).forEach((column: any, index: number) => {
      if (column?.header !== undefined) out.push({ path: `${at}.columns[${index}].header`, value: column.header });
    });
  }
  if (node.type === 'totals') {
    (node.rows ?? []).forEach((row: any, index: number) => {
      if (row?.label !== undefined) out.push({ path: `${at}.rows[${index}].label`, value: row.label });
    });
  }

  (node.children ?? []).forEach((child: any, index: number) =>
    collectLabelSites(child, `${at}.children[${index}]`, out)
  );
  return out;
};

const collectTextExpressions = (node: any, at: string, out: Array<{ path: string; content: any }> = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text') out.push({ path: at, content: node.content });
  (node.children ?? []).forEach((child: any, index: number) =>
    collectTextExpressions(child, `${at}.children[${index}]`, out)
  );
  return out;
};

/**
 * Every machine identifier in a template: node ids, binding ids, transform ids,
 * column ids, totals row ids and every data path. These decide what a document
 * says; translating one would silently corrupt rendered output while passing
 * every other gate, so they are pinned.
 */
const collectIdentifiers = (ast: TemplateAst): string[] => {
  const out: string[] = [];
  const walk = (node: any, at: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        typeof value === 'string' &&
        (key === 'id' || key === 'bindingId' || key === 'path' || key === 'itemBinding' ||
          key === 'rowBinding' || key === 'aggregateId' || key === 'sourceBindingId' ||
          key === 'outputBindingId' || key === 'strategyId' || key === 'i18nKey')
      ) {
        out.push(`${at}.${key}=${value}`);
        continue;
      }
      walk(value, `${at}.${key}`);
    }
  };
  walk(ast, '$');
  return out.sort();
};

const buildManifest = () => {
  const manifest: Record<string, Record<string, string[]>> = {};
  for (const { family, catalog } of FAMILIES) {
    manifest[family] = {};
    for (const [code, ast] of Object.entries(catalog)) {
      manifest[family][code] = collectIdentifiers(ast);
    }
  }
  return manifest;
};

describe.each(FAMILIES)('standard $family templates speak the recipient language', ({ family, catalog }) => {
  const codes = Object.keys(catalog);

  it(`${family}: catalog is not empty`, () => {
    expect(codes.length).toBeGreaterThan(0);
  });

  it.each(codes)(`${family}: %s labels are translatable keys backed by the documents namespace`, (code) => {
    const ast = catalog[code]!;

    for (const site of collectLabelSites(ast.layout, '$.layout')) {
      expect(isTemplateI18nRef(site.value), `${code} ${site.path} is still a literal`).toBe(true);
      if (isTemplateI18nRef(site.value)) {
        expect(englishKeys.has(site.value.i18nKey), `${code} ${site.path} -> ${site.value.i18nKey} is missing`).toBe(
          true
        );
      }
    }

    for (const { path: at, content } of collectTextExpressions(ast.layout, '$.layout')) {
      if (content?.type !== 'literal' || typeof content.value !== 'string') continue;
      expect(LITERAL_ALLOWLIST.has(content.value), `${code} ${at} is untranslated English`).toBe(true);
    }
  });
});

describe('the catalog migration mirrors the catalog in code', () => {
  it('maps every shipped English label to the same key', async () => {
    const migration = await import(
      /* @vite-ignore */ path.resolve(
        __dirname,
        '../../../../../server/migrations/20260813120000_upsert_i18n_standard_document_template_asts.cjs'
      )
    );
    const migrationKeys: Record<string, string> =
      (migration as any).__LABEL_KEYS ?? (migration as any).default?.__LABEL_KEYS;
    expect(migrationKeys).toBeTruthy();

    for (const { catalog } of FAMILIES) {
      for (const [code, ast] of Object.entries(catalog)) {
        const sites: TemplateI18nText[] = collectLabelSites(ast.layout, '$.layout').map((site) => site.value);
        for (const { content } of collectTextExpressions(ast.layout, '$.layout')) {
          if (content?.type === 'i18n') sites.push(content);
        }

        for (const site of sites) {
          if (!isTemplateI18nRef(site)) continue;
          expect(
            migrationKeys[site.defaultValue],
            `${code}: migration has no key for ${JSON.stringify(site.defaultValue)}`
          ).toBe(site.i18nKey);
        }
      }
    }
  });
});

describe('standard template machine identifiers', () => {
  it('match the pinned manifest', () => {
    if (process.env.UPDATE_STANDARD_TEMPLATE_MANIFEST === '1') {
      fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(buildManifest(), null, 2)}\n`);
    }
    const pinned = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    expect(buildManifest()).toEqual(pinned);
  });
});
