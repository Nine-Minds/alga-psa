import type { TemplateAst, TemplateNode } from '@alga-psa/types';
import { describe, expect, it } from 'vitest';

import {
  STANDARD_INVOICE_TEMPLATE_ASTS,
  getStandardTemplateAstByCode,
} from '../../../lib/invoice-template-ast/standardTemplates';
import {
  STANDARD_QUOTE_TEMPLATE_ASTS,
  getStandardQuoteTemplateAstByCode,
} from '../../../lib/quote-template-ast/standardTemplates';
import { exportImportExportAst, roundTripAst } from './workspaceAst.roundtrip.helpers';

const collectNodeIds = (node: TemplateNode): string[] => {
  const ids: string[] = [];
  if (node.id) {
    ids.push(node.id);
  }
  if ('children' in node && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      ids.push(...collectNodeIds(child));
    });
  }
  return ids;
};

const assertStandardTemplateRegression = (
  source: TemplateAst,
  criticalNodeIds: readonly string[]
) => {
  const roundTripped = roundTripAst(source);

  expect(roundTripped.kind).toBe(source.kind);
  expect(roundTripped.version).toBe(source.version);
  expect(roundTripped.layout.type).toBe('document');
  expect(roundTripped.metadata?.templateName).toBe(source.metadata?.templateName);

  if (source.metadata?.printSettings) {
    expect(roundTripped.metadata?.printSettings).toEqual(source.metadata.printSettings);
  }

  const sourceValueBindings = Object.keys(source.bindings?.values ?? {}).sort();
  const sourceCollectionBindings = Object.keys(source.bindings?.collections ?? {}).sort();
  const roundValueBindings = Object.keys(roundTripped.bindings?.values ?? {}).sort();
  const roundCollectionBindings = Object.keys(roundTripped.bindings?.collections ?? {}).sort();

  expect(roundValueBindings).toEqual(sourceValueBindings);
  expect(roundCollectionBindings).toEqual(sourceCollectionBindings);

  const roundTrippedNodeIds = collectNodeIds(roundTripped.layout);
  criticalNodeIds.forEach((nodeId) => {
    expect(roundTrippedNodeIds).toContain(nodeId);
  });

  expect(exportImportExportAst(source)).toEqual(roundTripped);
};

describe('workspaceAst standard template regression coverage', () => {
  it.each([
    ['standard-default', ['invoice-number', 'line-items', 'totals']] as const,
    ['standard-detailed', ['issuer-logo', 'party-blocks', 'bill-to-card', 'totals-wrap']] as const,
    ['standard-grouped', ['issuer-logo', 'recurring-items', 'onetime-items', 'notes-totals-row']] as const,
  ])('keeps invoice template %s structurally stable across designer import/export', (templateCode, criticalNodeIds) => {
    const source = getStandardTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    assertStandardTemplateRegression(source, criticalNodeIds);
  });

  it.each([
    ['standard-quote-default', ['quote-number', 'line-items', 'totals', 'signature-block']] as const,
    ['standard-quote-detailed', ['phase-summary', 'line-items-detailed', 'version', 'signature-block']] as const,
    ['standard-quote-grouped', ['monthly-items', 'onetime-items', 'terms-section', 'signature-block']] as const,
  ])('keeps quote template %s structurally stable across designer import/export', (templateCode, criticalNodeIds) => {
    const source = getStandardQuoteTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    assertStandardTemplateRegression(source, criticalNodeIds);
  });

  it('covers every shipped standard invoice and quote template code', () => {
    expect(Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS).sort()).toEqual(['standard-default', 'standard-detailed', 'standard-grouped']);
    expect(Object.keys(STANDARD_QUOTE_TEMPLATE_ASTS).sort()).toEqual(['standard-quote-default', 'standard-quote-detailed', 'standard-quote-grouped']);
  });
});
