import { describe, expect, it } from 'vitest';
import type { TemplateAst } from '@alga-psa/types';
import { STANDARD_QUOTE_TEMPLATE_ASTS, getStandardQuoteTemplateAstByCode } from '../../../lib/quote-template-ast/standardTemplates';
import { getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';
import { cloneAst, findNodeById, listNodesByType, roundTripAst } from './workspaceAst.roundtrip.helpers';
import type { DesignerWorkspaceSnapshot } from '../state/designerStore';

const PURPLE_BG = '#7c45d3';
const PURPLE_TEXT = '#ffffff';

const findTotalsRows = (ast: TemplateAst): Array<Record<string, any>> => {
  const totals = listNodesByType(ast.layout, 'totals').find((node) =>
    node.rows.some((row) => row.id === 'monthly-total' || row.id === 'onetime-total')
  );
  if (!totals) {
    throw new Error('Grouped totals node not found');
  }
  return totals.rows as unknown as Array<Record<string, any>>;
};

const findWorkspaceNode = (workspace: DesignerWorkspaceSnapshot, type: string): { id: string; props: any } | null => {
  const walk = (id: string): { id: string; props: any } | null => {
    const node = workspace.nodesById[id];
    if (!node) return null;
    if (node.type === type) return { id: node.id, props: node.props };
    for (const childId of node.children ?? []) {
      const found = walk(childId);
      if (found) return found;
    }
    return null;
  };
  return walk(workspace.rootId);
};

const setWorkspaceRowColors = (
  workspace: DesignerWorkspaceSnapshot,
  nodeId: string,
  colors: Record<string, { backgroundColor: string; color: string }>
): void => {
  const node = workspace.nodesById[nodeId];
  const metadata = (node?.props as { metadata?: Record<string, unknown> })?.metadata;
  if (!Array.isArray(metadata?.totalsRows)) {
    throw new Error('No totalsRows to edit');
  }
  metadata.totalsRows = metadata.totalsRows.map((row: Record<string, any>) => {
    const target = colors[String(row.id)];
    if (!target) {
      return row;
    }
    const inline = (row.style && typeof row.style === 'object' ? row.style.inline : {}) as Record<string, unknown>;
    return {
      ...row,
      style: { inline: { ...inline, backgroundColor: target.backgroundColor, color: target.color } },
    };
  });
};

const applyExpectedRowColors = (
  ast: TemplateAst,
  colors: Record<string, { backgroundColor: string; color: string }>
): TemplateAst => {
  const next = cloneAst(ast);
  const totals = listNodesByType(next.layout, 'totals').find((node) =>
    node.rows.some((row) => row.id === 'monthly-total' || row.id === 'onetime-total')
  );
  if (!totals || totals.type !== 'totals') {
    throw new Error('Grouped totals node not found');
  }
  totals.rows = totals.rows.map((row) => {
    const target = colors[row.id];
    if (!target) return row;
    const inline = (row.style && typeof row.style === 'object' ? row.style.inline : {}) as Record<string, unknown>;
    return { ...row, style: { inline: { ...inline, backgroundColor: target.backgroundColor, color: target.color } } };
  });
  return next;
};

describe('workspaceAst totals-row branding round trips', () => {
  const EDITED = {
    'monthly-total': { backgroundColor: '#0f766e', color: '#022c22' },
    'onetime-total': { backgroundColor: '#b91c1c', color: '#fef2f2' },
  } as Record<string, { backgroundColor: string; color: string }>;

  it('T004 quote AST round trip preserves edited colors, ids, i18n labels, bindings, formats, emphasis, ordering, and unrelated styles', () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-grouped');
    expect(source).toBeTruthy();
    if (!source) return;

    const baseline = roundTripAst(source);
    const baselineRows = findTotalsRows(baseline);
    const monthlyBaseline = baselineRows.find((row) => row.id === 'monthly-total');
    expect(monthlyBaseline).toBeTruthy();
    if (!monthlyBaseline) return;
    expect(monthlyBaseline.label).toEqual({ i18nKey: 'labels.monthlyTotal', defaultValue: 'Monthly Total' });
    expect(monthlyBaseline.style?.inline?.backgroundColor).toBe(PURPLE_BG);
    expect(monthlyBaseline.style?.inline?.color).toBe(PURPLE_TEXT);
    expect(monthlyBaseline.emphasize).toBe(true);
    expect(monthlyBaseline.value).toEqual({ type: 'binding', bindingId: 'recurringTotal' });
    expect(monthlyBaseline.format).toBe('currency');

    // Unstyled rows must not gain synthetic style wrappers from a designer pass.
    const subtotalBaseline = baselineRows.find((row) => row.id === 'monthly-subtotal');
    expect(subtotalBaseline).toBeTruthy();
    if (subtotalBaseline) {
      expect(Object.prototype.hasOwnProperty.call(subtotalBaseline, 'style')).toBe(false);
    }
    const ids = baselineRows.map((row) => row.id);
    expect(ids).toEqual([
      'monthly-subtotal',
      'monthly-tax',
      'monthly-total',
      'onetime-subtotal',
      'onetime-tax',
      'onetime-total',
    ]);

    // Simulate the widget writing edited colors into metadata.totalsRows.
    const workspace = importTemplateAstToWorkspace(cloneAst(source));
    const totalsNode = findWorkspaceNode(workspace, 'totals');
    expect(totalsNode).toBeTruthy();
    if (!totalsNode) return;
    setWorkspaceRowColors(workspace, totalsNode.id, EDITED);
    const exported = exportWorkspaceToTemplateAst(workspace);

    const expected = applyExpectedRowColors(baseline, EDITED);
    expect(exported).toEqual(expected);

    const editedRows = findTotalsRows(exported);
    const editedMonthly = editedRows.find((row) => row.id === 'monthly-total');
    expect(editedMonthly?.style?.inline).toMatchObject({ ...EDITED['monthly-total'], padding: '4px 6px', borderRadius: '4px', margin: '2px 0' });
    expect(editedRows.find((row) => row.id === 'onetime-total')?.style?.inline?.backgroundColor).toBe('#b91c1c');
    expect(editedRows.find((row) => row.id === 'monthly-subtotal')).toBeTruthy();
  });

  it('T005 invoice AST round trip exercises the same widget contract and keeps unstyled rows free of synthetic styles', () => {
    const source = getStandardTemplateAstByCode('standard-grouped');
    expect(source).toBeTruthy();
    if (!source) return;

    const baseline = roundTripAst(source);
    const baselineRows = findTotalsRows(baseline);
    const invoiceMonthly = baselineRows.find((row) => row.id === 'monthly-total');
    expect(invoiceMonthly?.style?.inline?.backgroundColor).toBe(PURPLE_BG);
    expect(invoiceMonthly?.style?.inline?.color).toBe(PURPLE_TEXT);

    const workspace = importTemplateAstToWorkspace(cloneAst(source));
    const totalsNode = findWorkspaceNode(workspace, 'totals');
    expect(totalsNode).toBeTruthy();
    if (!totalsNode) return;
    setWorkspaceRowColors(workspace, totalsNode.id, EDITED);
    const exported = exportWorkspaceToTemplateAst(workspace);
    expect(exported).toEqual(applyExpectedRowColors(baseline, EDITED));

    // The plain default invoice template has no row colors at all; round-tripping
    // must not synthesize style wrappers for its rows.
    const plainSource = getStandardTemplateAstByCode('standard-default');
    expect(plainSource).toBeTruthy();
    if (!plainSource) return;
    const plain = roundTripAst(plainSource);
    const totals = listNodesByType(plain.layout, 'totals')[0];
    expect(totals).toBeTruthy();
    if (!totals || totals.type !== 'totals') return;
    for (const row of totals.rows) {
      expect(Object.prototype.hasOwnProperty.call(row, 'style')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, 'labelStyle')).toBe(false);
    }
  });

  it('T007 save/reopen loads existing grouped-template colors, persists edits, and leaves header/table branding untouched', () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-grouped');
    expect(source).toBeTruthy();
    if (!source) return;

    const baseline = roundTripAst(source);

    // Opening an existing copy of the grouped template surfaces the saved row styles.
    const workspaceOpen = importTemplateAstToWorkspace(cloneAst(source));
    const totalsNode = findWorkspaceNode(workspaceOpen, 'totals');
    expect(totalsNode).toBeTruthy();
    if (!totalsNode) return;
    const openedRows = ((totalsNode.props as { metadata?: Record<string, unknown> })?.metadata?.totalsRows ?? []) as Array<Record<string, any>>;
    expect(openedRows.find((row) => row.id === 'monthly-total')?.style?.inline?.backgroundColor).toBe(PURPLE_BG);
    expect(openedRows.find((row) => row.id === 'monthly-total')?.style?.inline?.color).toBe(PURPLE_TEXT);

    // User edits two rows in the designer, then saves (export) and reopens (import).
    setWorkspaceRowColors(workspaceOpen, totalsNode.id, EDITED);
    const savedAst = exportWorkspaceToTemplateAst(workspaceOpen);
    const reopenedWorkspace = importTemplateAstToWorkspace(cloneAst(savedAst));
    const reopenedTotals = findWorkspaceNode(reopenedWorkspace, 'totals');
    expect(reopenedTotals).toBeTruthy();
    if (!reopenedTotals) return;
    const reopenedRows = ((reopenedTotals.props as { metadata?: Record<string, unknown> })?.metadata?.totalsRows ?? []) as Array<Record<string, any>>;
    expect(reopenedRows.find((row) => row.id === 'monthly-total')?.style?.inline?.backgroundColor).toBe('#0f766e');
    expect(reopenedRows.find((row) => row.id === 'monthly-total')?.style?.inline?.color).toBe('#022c22');
    expect(reopenedRows.find((row) => row.id === 'onetime-total')?.style?.inline?.color).toBe('#fef2f2');

    // Header/table branding outside the edited rows is byte-identical to the round trip.
    const reopenedExport = exportWorkspaceToTemplateAst(reopenedWorkspace);
    expect(reopenedExport).toEqual(applyExpectedRowColors(baseline, EDITED));

    const baselineHeaders = listNodesByType(baseline.layout, 'dynamic-table').map((table) => table.headerStyle);
    const reopenedHeaders = listNodesByType(reopenedExport.layout, 'dynamic-table').map((table) => table.headerStyle);
    expect(reopenedHeaders).toEqual(baselineHeaders);
    expect(reopenedHeaders.some((header) => header?.inline?.backgroundColor === PURPLE_BG)).toBe(true);
  });

  it('export helpers never mutate the source template', () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-grouped');
    expect(source).toBeTruthy();
    if (!source) return;
    const before = JSON.stringify(source);
    const workspace = importTemplateAstToWorkspace(cloneAst(source));
    const totalsNode = findWorkspaceNode(workspace, 'totals');
    expect(totalsNode).toBeTruthy();
    if (!totalsNode) return;
    setWorkspaceRowColors(workspace, totalsNode.id, EDITED);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('grouped standard template row fixture sanity', () => {
  it('both grouped standards carry purple/white saved row styles (no migration target)', () => {
    const quote = STANDARD_QUOTE_TEMPLATE_ASTS['standard-quote-grouped'];
    const invoice = getStandardTemplateAstByCode('standard-grouped');
    for (const ast of [quote, invoice]) {
      if (!ast) continue;
      const rows = findTotalsRows(ast);
      expect(rows.find((row) => row.id === 'monthly-total')?.style?.inline?.backgroundColor).toBe(PURPLE_BG);
      expect(rows.find((row) => row.id === 'onetime-total')?.style?.inline?.color).toBe(PURPLE_TEXT);
    }
  });
});

describe('workspaceAst grouped totals regression coverage', () => {
  it('round-trips every grouped standard quote/invoice template deterministically', () => {
    for (const code of ['standard-quote-grouped', 'standard-quote-default', 'standard-grouped', 'standard-default']) {
      const source = code.startsWith('standard-quote')
        ? getStandardQuoteTemplateAstByCode(code)
        : getStandardTemplateAstByCode(code);
      expect(source).toBeTruthy();
      if (!source) continue;
      const first = roundTripAst(source);
      const second = exportWorkspaceToTemplateAst(importTemplateAstToWorkspace(cloneAst(first)));
      expect(second).toEqual(first);
    }
  });

  it('imported group totals nodes still resolve by stable id', () => {
    const source = getStandardQuoteTemplateAstByCode('standard-quote-grouped');
    expect(source).toBeTruthy();
    if (!source) return;
    const layout = roundTripAst(source).layout;
    const totals = findNodeById(layout, 'totals');
    expect(totals).toBeTruthy();
  });
});
