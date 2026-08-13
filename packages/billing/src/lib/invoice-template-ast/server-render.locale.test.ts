import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { TEMPLATE_AST_VERSION } from '@alga-psa/types';
import { evaluateTemplateAst } from './evaluator';
import { renderTemplateAstHtmlDocument } from './server-render';

const bindings: NonNullable<TemplateAst['bindings']> = {
  values: {
    issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
  },
};

/** A standard-style template: translatable labels, plus locale-formatted values. */
const buildTranslatableAst = (metadataLocale?: string): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: metadataLocale ? { locale: metadataLocale } : undefined,
  bindings,
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header',
        type: 'section',
        title: { i18nKey: 'labels.invoice', defaultValue: 'Invoice' },
        children: [
          {
            id: 'issue-date',
            type: 'field',
            label: { i18nKey: 'labels.issueDate', defaultValue: 'Issue Date' },
            binding: { bindingId: 'issueDate' },
            format: 'date',
          },
        ],
      },
      {
        id: 'bill-to-label',
        type: 'text',
        content: { type: 'i18n', i18nKey: 'labels.billTo', defaultValue: 'Bill To' },
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: { i18nKey: 'labels.emptyState.noLineItems', defaultValue: 'No line items' },
        columns: [
          {
            id: 'description',
            header: { i18nKey: 'labels.description', defaultValue: 'Description' },
            value: { type: 'path', path: 'description' },
          },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          {
            id: 'subtotal',
            label: { i18nKey: 'labels.subtotal', defaultValue: 'Subtotal' },
            value: { type: 'binding', bindingId: 'subtotal' },
            format: 'currency',
          },
        ],
      },
    ],
  },
});

/**
 * A template as a tenant who customized theirs has it: every display string is a
 * literal, authored by hand.
 */
const buildLiteralAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  bindings,
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header',
        type: 'section',
        title: 'Invoice',
        children: [
          {
            id: 'issue-date',
            type: 'field',
            label: 'Issue Date',
            binding: { bindingId: 'issueDate' },
          },
        ],
      },
      { id: 'bill-to-label', type: 'text', content: { type: 'literal', value: 'Bill To' } },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: 'No line items',
        columns: [
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' } },
        ],
      },
    ],
  },
});

const sampleData = {
  invoiceNumber: 'INV-3001',
  issueDate: '2026-03-04',
  subtotal: 123456,
  items: [{ id: 'a1', description: 'Managed backup', quantity: 1, unitPrice: 123456, total: 123456 }],
};

const bodyOf = (html: string): string => html.slice(html.indexOf('<body'));

describe('renderTemplateAstHtmlDocument label localization', () => {
  it('renders standard-template labels in the recipient locale', async () => {
    const ast = buildTranslatableAst();
    const evaluation = evaluateTemplateAst(ast, sampleData);

    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { locale: 'de' });

    expect(html).toContain('Rechnung');
    expect(html).toContain('Rechnungsdatum');
    expect(html).toContain('Rechnung an');
    expect(html).toContain('Beschreibung');
    expect(html).toContain('Zwischensumme');
    expect(html).toContain('<html lang="de">');
  });

  it('formats dates and currency in the same locale as the labels', async () => {
    const ast = buildTranslatableAst();
    const evaluation = evaluateTemplateAst(ast, sampleData);

    const german = await renderTemplateAstHtmlDocument(ast, evaluation, { locale: 'de' });
    const english = await renderTemplateAstHtmlDocument(ast, evaluation, { locale: 'en' });

    // 2026-03-04 reads day-first in German, month-first in English.
    expect(german).toContain('4.3.2026');
    expect(english).toContain('3/4/2026');
    // 1234.56 uses a comma as the decimal separator in German.
    expect(german).toContain('1.234,56');
    expect(english).toContain('1,234.56');
  });

  it('lets the recipient locale win over the template metadata locale', async () => {
    const ast = buildTranslatableAst('en-US');
    const evaluation = evaluateTemplateAst(ast, sampleData);

    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { locale: 'de' });

    expect(html).toContain('Zwischensumme');
    expect(html).not.toContain('>Subtotal<');
    // Formatting follows the same winner — one locale per document.
    expect(html).toContain('4.3.2026');
  });

  it('falls back to English when no recipient locale resolves', async () => {
    const ast = buildTranslatableAst();
    const evaluation = evaluateTemplateAst(ast, sampleData);

    const html = await renderTemplateAstHtmlDocument(ast, evaluation, {});

    expect(html).toContain('Invoice');
    expect(html).toContain('Issue Date');
    expect(html).toContain('Subtotal');
    expect(html).toContain('<html lang="en">');
  });

  it('falls back to English for a locale we do not ship', async () => {
    const ast = buildTranslatableAst();
    const evaluation = evaluateTemplateAst(ast, sampleData);

    const html = await renderTemplateAstHtmlDocument(ast, evaluation, { locale: 'kl-GL' });

    expect(html).toContain('Subtotal');
    expect(html).toContain('<html lang="en">');
  });

  it('leaves a customized (literal-only) template byte-identical under any locale', async () => {
    const ast = buildLiteralAst();
    const evaluation = evaluateTemplateAst(ast, sampleData);

    const baseline = await renderTemplateAstHtmlDocument(ast, evaluation, { title: 'Invoice' });
    const german = await renderTemplateAstHtmlDocument(ast, evaluation, { title: 'Invoice', locale: 'de' });

    // Every hand-authored label survives verbatim: the document body is the same
    // markup it was before translatable labels existed.
    expect(bodyOf(german)).toBe(bodyOf(baseline));
    expect(german).toContain('Subtotal');
    expect(german).not.toContain('Zwischensumme');
  });
});
