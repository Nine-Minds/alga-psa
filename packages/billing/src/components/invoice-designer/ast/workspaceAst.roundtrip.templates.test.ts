import type { TemplateNode, TemplateTableColumn } from '@alga-psa/types';
import { describe, expect, it } from 'vitest';
import { STANDARD_INVOICE_TEMPLATE_ASTS, getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';
import { STANDARD_QUOTE_TEMPLATE_ASTS, getStandardQuoteTemplateAstByCode } from '../../../lib/quote-template-ast/standardTemplates';
import { exportImportExportAst, roundTripAst } from './workspaceAst.roundtrip.helpers';

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const assertColumnSemantics = (source: TemplateTableColumn, roundTripped: TemplateTableColumn) => {
  expect(roundTripped.id).toBe(source.id);
  expect(roundTripped.header).toEqual(source.header);
  expect(roundTripped.value).toEqual(source.value);
  if (hasOwn(source, 'format')) {
    expect(roundTripped.format).toBe(source.format);
  }
  if (source.style?.tokenIds) {
    expect(roundTripped.style?.tokenIds).toEqual(source.style.tokenIds);
  }
  if (source.style?.inline) {
    expect(roundTripped.style?.inline).toMatchObject(source.style.inline);
  }
};

const assertNodeSemantics = (source: TemplateNode, roundTripped: TemplateNode) => {
  expect(roundTripped.id).toBe(source.id);
  expect(roundTripped.type).toBe(source.type);

  if (source.style?.tokenIds) {
    expect(roundTripped.style?.tokenIds).toEqual(source.style.tokenIds);
  }
  if (source.style?.inline) {
    expect(roundTripped.style?.inline).toMatchObject(source.style.inline);
  }

  switch (source.type) {
    case 'document':
      expect(roundTripped.type).toBe('document');
      if (roundTripped.type !== 'document') return;
      expect(roundTripped.children.length).toBe(source.children.length);
      source.children.forEach((sourceChild, index) => assertNodeSemantics(sourceChild, roundTripped.children[index]!));
      return;
    case 'section':
      expect(roundTripped.type).toBe('section');
      if (roundTripped.type !== 'section') return;
      expect(roundTripped.title).toEqual(source.title);
      expect(roundTripped.children.length).toBe(source.children.length);
      source.children.forEach((sourceChild, index) => assertNodeSemantics(sourceChild, roundTripped.children[index]!));
      return;
    case 'stack':
      expect(roundTripped.type).toBe('stack');
      if (roundTripped.type !== 'stack') return;
      expect(roundTripped.direction).toBe(source.direction);
      expect(roundTripped.children.length).toBe(source.children.length);
      source.children.forEach((sourceChild, index) => assertNodeSemantics(sourceChild, roundTripped.children[index]!));
      return;
    case 'text':
      expect(roundTripped.type).toBe('text');
      if (roundTripped.type !== 'text') return;
      expect(roundTripped.content).toEqual(source.content);
      return;
    case 'field':
      expect(roundTripped.type).toBe('field');
      if (roundTripped.type !== 'field') return;
      expect(roundTripped.binding).toEqual(source.binding);
      expect(roundTripped.label).toEqual(source.label);
      if (hasOwn(source, 'format')) {
        expect(roundTripped.format).toBe(source.format);
      }
      if (hasOwn(source, 'emptyValue')) {
        expect(roundTripped.emptyValue).toBe(source.emptyValue);
      }
      return;
    case 'image':
      expect(roundTripped.type).toBe('image');
      if (roundTripped.type !== 'image') return;
      expect(roundTripped.src).toEqual(source.src);
      if (hasOwn(source, 'alt')) {
        expect(roundTripped.alt).toEqual(source.alt);
      }
      return;
    case 'divider':
      expect(roundTripped.type).toBe('divider');
      return;
    case 'table':
      // Designer importer currently normalizes table nodes to dynamic-table.
      expect(roundTripped.type).toBe('dynamic-table');
      if (roundTripped.type !== 'dynamic-table') return;
      expect(roundTripped.repeat.sourceBinding).toEqual(source.sourceBinding);
      source.columns.forEach((sourceColumn, index) => assertColumnSemantics(sourceColumn, roundTripped.columns[index]!));
      return;
    case 'dynamic-table':
      expect(roundTripped.type).toBe('dynamic-table');
      if (roundTripped.type !== 'dynamic-table') return;
      expect(roundTripped.repeat.sourceBinding).toEqual(source.repeat.sourceBinding);
      expect(roundTripped.repeat.itemBinding).toBe('item');
      expect(roundTripped.columns.length).toBe(source.columns.length);
      source.columns.forEach((sourceColumn, index) => assertColumnSemantics(sourceColumn, roundTripped.columns[index]!));
      if (hasOwn(source, 'emptyStateText')) {
        expect(roundTripped.emptyStateText).toEqual(source.emptyStateText);
      }
      return;
    case 'totals':
      expect(roundTripped.type).toBe('totals');
      if (roundTripped.type !== 'totals') return;
      expect(roundTripped.sourceBinding).toEqual(source.sourceBinding);
      expect(roundTripped.rows).toEqual(source.rows);
      return;
    default:
      return;
  }
};

describe('workspaceAst standard template roundtrip coverage', () => {
  const templateCodes = Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS).sort();

  it('covers every standard template code', () => {
    expect(templateCodes.length).toBeGreaterThan(0);
  });

  it.each(templateCodes)('round-trips semantic node fidelity for %s', (templateCode) => {
    const source = getStandardTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    const roundTripped = roundTripAst(source);
    expect(roundTripped.kind).toBe(source.kind);
    expect(roundTripped.version).toBe(source.version);
    expect(roundTripped.metadata).toEqual(source.metadata);
    expect(roundTripped.styles).toEqual(source.styles);

    const sourceValueBindings = source.bindings?.values ?? {};
    const sourceCollectionBindings = source.bindings?.collections ?? {};
    const roundValueBindings = roundTripped.bindings?.values ?? {};
    const roundCollectionBindings = roundTripped.bindings?.collections ?? {};

    expect(Object.keys(roundValueBindings).sort()).toEqual(Object.keys(sourceValueBindings).sort());
    expect(Object.keys(roundCollectionBindings).sort()).toEqual(Object.keys(sourceCollectionBindings).sort());

    for (const [bindingId, sourceBinding] of Object.entries(sourceValueBindings)) {
      expect(roundValueBindings[bindingId]).toEqual(sourceBinding);
    }
    for (const [bindingId, sourceBinding] of Object.entries(sourceCollectionBindings)) {
      expect(roundCollectionBindings[bindingId]).toEqual(sourceBinding);
    }

    assertNodeSemantics(source.layout, roundTripped.layout);
  });

  it.each(templateCodes)('is deterministic after repeated export/import cycles for %s', (templateCode) => {
    const source = getStandardTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    const astOnce = roundTripAst(source);
    const astTwice = exportImportExportAst(source);
    expect(astTwice).toEqual(astOnce);
  });
});

describe('workspaceAst standard quote template column roundtrip coverage', () => {
  const quoteTemplateCodes = Object.keys(STANDARD_QUOTE_TEMPLATE_ASTS).sort();

  const collectColumns = (node: TemplateNode, out: TemplateTableColumn[] = []): TemplateTableColumn[] => {
    if (node.type === 'dynamic-table' || node.type === 'table') {
      out.push(...node.columns);
    }
    if ('children' in node && Array.isArray(node.children)) {
      node.children.forEach((child) => collectColumns(child, out));
    }
    return out;
  };

  // alga-2026-0002354 — the stacked name/description cell is a template value
  // expression; the designer must round-trip it instead of flattening it to a path.
  it.each(quoteTemplateCodes)('preserves the stacked description cell for %s', (templateCode) => {
    const source = getStandardQuoteTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    const sourceColumns = collectColumns(source.layout).filter((column) => column.id === 'description');
    expect(sourceColumns.length).toBeGreaterThan(0);

    const roundTripped = roundTripAst(source);
    const roundTrippedColumns = collectColumns(roundTripped.layout).filter((column) => column.id === 'description');

    expect(roundTrippedColumns.length).toBe(sourceColumns.length);
    roundTrippedColumns.forEach((column, index) => {
      expect(column.value).toEqual(sourceColumns[index]!.value);
      expect(column.value.type).toBe('template');
    });
  });
});
