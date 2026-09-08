import { describe, expect, it } from 'vitest';
import type { TemplateAst, TemplateTotalsNode } from '@alga-psa/types';
import { createAstDocument, findNodeById, getDocumentNode, roundTripAst } from './workspaceAst.roundtrip.helpers';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from './workspaceAst';

type InlineStyleCase = {
  key: string;
  value: unknown;
  expected?: unknown;
};

describe('workspaceAst roundtrip style matrix', () => {
  const styleCases: InlineStyleCase[] = [
    { key: 'display', value: 'flex' },
    { key: 'width', value: '320px' },
    { key: 'height', value: '180px' },
    { key: 'minWidth', value: '160px' },
    { key: 'minHeight', value: '40px' },
    { key: 'maxWidth', value: '640px' },
    { key: 'maxHeight', value: '420px' },
    { key: 'padding', value: '10px 12px' },
    { key: 'margin', value: '8px 0' },
    { key: 'border', value: '1px solid #d1d5db' },
    { key: 'borderRadius', value: '8px' },
    { key: 'gap', value: '12px' },
    { key: 'justifyContent', value: 'space-between' },
    { key: 'alignItems', value: 'center' },
    { key: 'color', value: '#111827' },
    { key: 'backgroundColor', value: '#f9fafb' },
    { key: 'fontSize', value: '14px' },
    { key: 'fontWeight', value: 600 },
    { key: 'fontFamily', value: '"IBM Plex Sans", sans-serif' },
    { key: 'lineHeight', value: 1.35 },
    { key: 'textAlign', value: 'right' },
    { key: 'flexDirection', value: 'row' },
    { key: 'flexGrow', value: 1 },
    { key: 'flexShrink', value: 0 },
    { key: 'flexBasis', value: 'auto' },
    { key: 'aspectRatio', value: '16 / 9' },
    { key: 'objectFit', value: 'contain' },
    { key: 'objectPosition', value: 'right bottom' },
    { key: 'gridTemplateColumns', value: '1fr 2fr' },
    { key: 'gridTemplateRows', value: 'auto auto' },
    { key: 'gridAutoFlow', value: 'row dense' },
  ];

  it.each(styleCases)('round-trips inline style property %s', ({ key, value, expected }) => {
    const ast = createAstDocument([
      {
        id: 'styled-text',
        type: 'text',
        content: { type: 'literal', value: 'Styled' },
        style: {
          inline: {
            [key]: value,
          } as Record<string, unknown>,
        } as any,
      },
    ]);

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    const styled = findNodeById(layout, 'styled-text');
    expect(styled?.type).toBe('text');
    if (!styled) return;

    const inline = styled.style?.inline as Record<string, unknown> | undefined;
    expect(inline).toBeTruthy();
    expect(inline?.[key]).toEqual(expected ?? value);
  });

  it('round-trips style tokenIds with inline declarations', () => {
    const ast = createAstDocument([
      {
        id: 'tokenized-text',
        type: 'text',
        content: { type: 'literal', value: 'Tokenized' },
        style: {
          tokenIds: ['text-primary', 'text-lg'],
          inline: {
            color: '#1f2937',
            fontWeight: 700,
          },
        } as any,
      },
    ]);

    const roundTripped = roundTripAst(ast);
    const layout = getDocumentNode(roundTripped);
    const tokenized = findNodeById(layout, 'tokenized-text');
    expect(tokenized?.type).toBe('text');
    if (!tokenized) return;

    expect(tokenized.style?.tokenIds).toEqual(['text-primary', 'text-lg']);
    expect(tokenized.style?.inline).toMatchObject({
      color: '#1f2937',
      fontWeight: 700,
    });
  });
});

// alga-2026-0002355 — emphasized totals rows shipped with a hardcoded brand
// color; the designer now exposes it as an editable Highlight Row Style.
describe('workspaceAst totals highlight row colors', () => {
  const createTotalsAst = (emphasisStyle?: Record<string, unknown>): TemplateAst =>
    createAstDocument([
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'monthly-subtotal', label: 'Monthly', value: { type: 'path', path: 'recurring_subtotal' }, format: 'currency' },
          {
            id: 'monthly-total',
            label: 'Monthly Total',
            value: { type: 'path', path: 'recurring_total' },
            format: 'currency',
            emphasize: true,
            ...(emphasisStyle ? { style: { inline: emphasisStyle } } : {}),
          },
          {
            id: 'onetime-total',
            label: 'One-time Total',
            value: { type: 'path', path: 'onetime_total' },
            format: 'currency',
            emphasize: true,
            ...(emphasisStyle ? { style: { inline: emphasisStyle } } : {}),
          },
        ],
      } as TemplateTotalsNode,
    ], {
      bindings: {
        values: {},
        collections: { lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' } },
      },
    });

  const purple = { backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px', borderRadius: '4px' };

  const findTotalsNode = (ast: TemplateAst): TemplateTotalsNode => {
    const node = findNodeById(getDocumentNode(ast), 'totals');
    expect(node?.type).toBe('totals');
    return node as TemplateTotalsNode;
  };

  it('round-trips the shipped emphasized row colors unchanged', () => {
    const roundTripped = roundTripAst(createTotalsAst(purple));
    const totals = findTotalsNode(roundTripped);

    for (const row of totals.rows.filter((candidate) => candidate.emphasize)) {
      expect(row.style?.inline).toMatchObject(purple);
    }
  });

  it('seeds the inspector fields from the first emphasized row', () => {
    const workspace = importTemplateAstToWorkspace(createTotalsAst(purple));
    const totalsNode = Object.values(workspace.nodesById).find((node) => node.id === 'totals') as any;

    expect(totalsNode?.props?.metadata?.totalsEmphasisBackgroundColor).toBe('#7c45d3');
    expect(totalsNode?.props?.metadata?.totalsEmphasisColor).toBe('#ffffff');
  });

  it('exports edited highlight colors onto every emphasized row', () => {
    const workspace = importTemplateAstToWorkspace(createTotalsAst(purple));
    const totalsId = Object.values(workspace.nodesById).find((node) => node.id === 'totals')!.id;
    const totalsNode = workspace.nodesById[totalsId]!;

    workspace.nodesById[totalsId] = {
      ...totalsNode,
      props: {
        ...totalsNode.props,
        metadata: {
          ...(totalsNode.props.metadata as Record<string, unknown>),
          totalsEmphasisBackgroundColor: '#0f766e',
          totalsEmphasisColor: '#f0fdfa',
        },
      },
    };

    const totals = findTotalsNode(exportWorkspaceToTemplateAst(workspace));
    const emphasized = totals.rows.filter((row) => row.emphasize);
    expect(emphasized.length).toBe(2);

    for (const row of emphasized) {
      expect(row.style?.inline?.backgroundColor).toBe('#0f766e');
      expect(row.style?.inline?.color).toBe('#f0fdfa');
      // Untouched decorations survive the overlay.
      expect(row.style?.inline?.borderRadius).toBe('4px');
    }

    // Non-emphasized rows stay uncolored.
    expect(totals.rows.find((row) => row.id === 'monthly-subtotal')?.style?.inline?.backgroundColor).toBeUndefined();
  });

  it('leaves templates without emphasized row colors untouched', () => {
    const roundTripped = roundTripAst(createTotalsAst());
    const totals = findTotalsNode(roundTripped);

    for (const row of totals.rows) {
      expect(row.style?.inline?.backgroundColor).toBeUndefined();
      expect(row.style?.inline?.color).toBeUndefined();
    }
  });
});
