import type { TemplateAst, TemplateNode } from '@alga-psa/types';
import { describe, expect, it } from 'vitest';

import { evaluateTemplateAst } from '../../../lib/invoice-template-ast/evaluator';
import { renderEvaluatedTemplateAst } from '../../../lib/invoice-template-ast/react-renderer';
import {
  STANDARD_INVOICE_TEMPLATE_ASTS,
  getStandardTemplateAstByCode,
} from '../../../lib/invoice-template-ast/standardTemplates';
import {
  STANDARD_QUOTE_TEMPLATE_ASTS,
  getStandardQuoteTemplateAstByCode,
} from '../../../lib/quote-template-ast/standardTemplates';
import { exportImportExportAst, findNodeById, roundTripAst } from './workspaceAst.roundtrip.helpers';

const invoiceTemplateCases = [
  ['standard-bundle-quantities', ['invoice-number', 'line-items', 'totals']],
  ['standard-default', ['invoice-number', 'line-items', 'totals']],
  ['standard-detailed', ['issuer-logo', 'party-blocks', 'bill-to-card', 'totals-wrap']],
  ['standard-grouped', ['issuer-logo', 'recurring-items', 'onetime-items', 'notes-totals-row']],
  ['standard-invoice-by-location', ['location-bands', 'location-band-header', 'location-band-items', 'location-band-subtotal', 'totals-wrap']],
  ['standard-invoice-by-ticket', ['invoice-number', 'ticket-coverage-note', 'ticket-time-summary', 'billed-time-portal-note', 'totals-wrap']],
] as const;

const quoteTemplateCases = [
  ['standard-quote-default', ['quote-number', 'line-items', 'totals', 'signature-block']],
  ['standard-quote-detailed', ['phase-summary', 'line-items-detailed', 'version', 'signature-block']],
  ['standard-quote-grouped', ['cadence-bands', 'cadence-band-items', 'cadence-optional-bands', 'terms-section', 'signature-block']],
  ['standard-quote-by-location', ['location-bands', 'location-band-header', 'location-band-items', 'location-band-subtotal', 'totals', 'signature-block']],
] as const;

const BREAK_STYLE_KEYS = ['breakInside', 'breakAfter', 'breakBefore'] as const;

type NodeBreakStyles = { id: string; breaks: Record<string, unknown> };

/** Keep-together / forced-break rules authored on a template's own nodes. */
const collectNodeBreakStyles = (node: TemplateNode): NodeBreakStyles[] => {
  const collected: NodeBreakStyles[] = [];
  const inline = (node.style?.inline ?? {}) as Record<string, unknown>;
  const breaks = BREAK_STYLE_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    if (inline[key] !== undefined) {
      acc[key] = inline[key];
    }
    return acc;
  }, {});
  if (node.id && Object.keys(breaks).length > 0) {
    collected.push({ id: node.id, breaks });
  }
  if ('children' in node && Array.isArray(node.children)) {
    node.children.forEach((child) => {
      collected.push(...collectNodeBreakStyles(child));
    });
  }
  return collected;
};

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

  // Pagination rules are authored style, not decoration: dropping them on save
  // lets pricing bands split across pages again.
  collectNodeBreakStyles(source.layout).forEach(({ id, breaks }) => {
    const roundTrippedNode = findNodeById(roundTripped.layout, id);
    expect(roundTrippedNode, `node ${id} must survive the designer round trip`).toBeTruthy();
    expect(
      (roundTrippedNode?.style?.inline ?? {}) as Record<string, unknown>,
      `pagination rules on ${id} must survive a designer save`
    ).toMatchObject(breaks);
  });

  expect(exportImportExportAst(source)).toEqual(roundTripped);
};

describe('workspaceAst standard template regression coverage', () => {
  it.each(invoiceTemplateCases)('keeps invoice template %s structurally stable across designer import/export', (templateCode, criticalNodeIds) => {
    const source = getStandardTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    assertStandardTemplateRegression(source, criticalNodeIds);
  });

  it.each(quoteTemplateCases)('keeps quote template %s structurally stable across designer import/export', (templateCode, criticalNodeIds) => {
    const source = getStandardQuoteTemplateAstByCode(templateCode);
    expect(source).toBeTruthy();
    if (!source) return;

    assertStandardTemplateRegression(source, criticalNodeIds);
  });

  it('keeps the grouped quote cadence bands unsplittable after a designer save', () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-grouped')!;
    const authored = collectNodeBreakStyles(source.layout);
    // Guards the regression assertion above against a template that quietly
    // stops carrying pagination rules.
    expect(authored.length).toBeGreaterThan(0);

    const roundTripped = roundTripAst(source);
    const bandHeader = findNodeById(roundTripped.layout, 'cadence-band-header');
    expect((bandHeader?.style?.inline ?? {}) as Record<string, unknown>).toMatchObject({
      breakInside: 'avoid',
      breakAfter: 'avoid',
    });
  });

  it('covers every shipped standard invoice and quote template code', () => {
    expect(Object.keys(STANDARD_INVOICE_TEMPLATE_ASTS).sort()).toEqual(
      invoiceTemplateCases.map(([code]) => code).sort()
    );
    expect(Object.keys(STANDARD_QUOTE_TEMPLATE_ASTS).sort()).toEqual(
      quoteTemplateCases.map(([code]) => code).sort()
    );
  });

  it('renders bundle quantities and changes after designer import/export without exposing component prices', async () => {
    const source = getStandardTemplateAstByCode('standard-bundle-quantities')!;
    const ast = exportImportExportAst(source);
    const data = {
      currencyCode: 'USD',
      items: [{
        description: 'Managed endpoints', subtitle: 'Workstations and backup',
        quantity: 1, unitPrice: 624000, total: 624000,
        components: [
          { name: 'Workstations', quantity: 48, quantityChange: 2, unitPrice: 12345, total: 592560 },
          { name: 'Backup users', quantity: 45, quantityChange: -1, unitPrice: 54321, total: 2444445 },
        ],
      }],
    };
    const { html } = await renderEvaluatedTemplateAst(ast, evaluateTemplateAst(ast, data), { locale: 'en-US' });
    const document = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(Array.from(rows[0].querySelectorAll('td'), (cell) => cell.textContent)).toEqual([
      'Managed endpointsWorkstations and backup', '', '', '', '$6,240.00',
    ]);
    expect(Array.from(rows[1].querySelectorAll('td'), (cell) => cell.textContent)).toEqual([
      '• Workstations', '', '+248', '', '',
    ]);
    expect(Array.from(rows[2].querySelectorAll('td'), (cell) => cell.textContent)).toEqual([
      '• Backup users', '', '−145', '', '',
    ]);
  });
});
