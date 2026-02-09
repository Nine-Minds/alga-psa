import { describe, expect, it } from 'vitest';

import type { DesignerNode } from '../state/designerStore';
import {
  chooseBestSectionForInsertion,
  findNearestSectionAncestor,
  planForceSelectedInsertion,
  resolvePreferredParentFromSelection,
  resolveSectionParentForInsertion,
} from './dropParentResolution';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => {
  const { parentId, childIds, allowedChildren } = overrides;
  return {
    id: overrides.id ?? 'node-' + Math.random().toString(36).slice(2, 7),
    type: overrides.type ?? 'text',
    name: overrides.name ?? 'Node',
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 100, height: 40 },
    baseSize: overrides.baseSize ?? overrides.size ?? { width: 100, height: 40 },
    canRotate: overrides.canRotate ?? true,
    allowResize: overrides.allowResize ?? true,
    rotation: overrides.rotation ?? 0,
    metadata: overrides.metadata ?? {},
    layoutPresetId: overrides.layoutPresetId,
    layout: overrides.layout,
    parentId: parentId ?? null,
    childIds: childIds ?? [],
    allowedChildren: allowedChildren ?? [],
  };
};

describe('dropParentResolution', () => {
  it('prefers non-header section with better available space', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['header', 'body'],
      allowedChildren: ['section'],
    });
    const header = createNode({
      id: 'header',
      type: 'section',
      name: 'Header',
      parentId: 'page',
      size: { width: 700, height: 220 },
      childIds: ['header-text'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const headerText = createNode({
      id: 'header-text',
      type: 'text',
      parentId: 'header',
      size: { width: 600, height: 180 },
    });
    const body = createNode({
      id: 'body',
      type: 'section',
      name: 'Body',
      parentId: 'page',
      size: { width: 700, height: 560 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, header, headerText, body].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = chooseBestSectionForInsertion(page, nodesById, 'text');
    expect(picked?.id).toBe('body');
  });

  it('returns null when all fixed column sections are saturated', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['header', 'body'],
      allowedChildren: ['section'],
    });
    const header = createNode({
      id: 'header',
      type: 'section',
      name: 'Header',
      parentId: 'page',
      size: { width: 700, height: 220 },
      childIds: ['header-text'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const body = createNode({
      id: 'body',
      type: 'section',
      name: 'Body',
      parentId: 'page',
      size: { width: 700, height: 260 },
      childIds: ['body-text'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const headerText = createNode({
      id: 'header-text',
      type: 'text',
      parentId: 'header',
      size: { width: 600, height: 180 },
    });
    const bodyText = createNode({
      id: 'body-text',
      type: 'text',
      parentId: 'body',
      size: { width: 600, height: 220 },
    });

    const nodesById = new Map(
      [page, header, body, headerText, bodyText].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = chooseBestSectionForInsertion(page, nodesById, 'text');
    expect(picked).toBeNull();
  });

  it('prefers semantically matching section for table insertion', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['billing-info', 'line-items'],
      allowedChildren: ['section'],
    });
    const billingInfo = createNode({
      id: 'billing-info',
      type: 'section',
      name: 'Billing Info',
      parentId: 'page',
      size: { width: 700, height: 640 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const lineItems = createNode({
      id: 'line-items',
      type: 'section',
      name: 'Line Items',
      parentId: 'page',
      size: { width: 700, height: 420 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, billingInfo, lineItems].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = chooseBestSectionForInsertion(page, nodesById, 'table');
    expect(picked?.id).toBe('line-items');
  });

  it('prefers explicitly selected section before semantic heuristic when it can fit', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['billing-info', 'footer'],
      allowedChildren: ['section'],
    });
    const billingInfo = createNode({
      id: 'billing-info',
      type: 'section',
      name: 'Billing Info',
      parentId: 'page',
      size: { width: 700, height: 520 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 700, height: 320 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, billingInfo, footer].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = resolveSectionParentForInsertion({
      pageNode: page,
      nodesById,
      componentType: 'totals',
      desiredSize: { width: 360, height: 140 },
      preferredSectionId: 'footer',
    });

    expect(picked?.id).toBe('footer');
  });

  it('skips selected section when fit checks fail and picks heuristic section', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer', 'line-items'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 56, height: 180 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 12,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const lineItems = createNode({
      id: 'line-items',
      type: 'section',
      name: 'Line Items',
      parentId: 'page',
      size: { width: 700, height: 500 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, footer, lineItems].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = resolveSectionParentForInsertion({
      pageNode: page,
      nodesById,
      componentType: 'field',
      desiredSize: { width: 200, height: 48 },
      preferredSectionId: 'footer',
    });

    expect(picked?.id).toBe('line-items');
  });

  it('avoids row section with no horizontal room to prevent tiny-width insertion', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['selected-row', 'fallback'],
      allowedChildren: ['section'],
    });
    const selectedRow = createNode({
      id: 'selected-row',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 300, height: 180 },
      childIds: ['a', 'b'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const a = createNode({
      id: 'a',
      type: 'field',
      parentId: 'selected-row',
      size: { width: 120, height: 48 },
    });
    const b = createNode({
      id: 'b',
      type: 'field',
      parentId: 'selected-row',
      size: { width: 120, height: 48 },
    });
    const fallback = createNode({
      id: 'fallback',
      type: 'section',
      name: 'Billing Info',
      parentId: 'page',
      size: { width: 700, height: 360 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, selectedRow, fallback, a, b].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = resolveSectionParentForInsertion({
      pageNode: page,
      nodesById,
      componentType: 'field',
      desiredSize: { width: 200, height: 48 },
      preferredSectionId: 'selected-row',
    });

    expect(picked?.id).toBe('fallback');
  });

  it('skips selected footer for signature when row room is too small', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer', 'signature-area'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 420, height: 180 },
      childIds: ['totals-row'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fill',
      },
    });
    const totalsRow = createNode({
      id: 'totals-row',
      type: 'totals',
      parentId: 'footer',
      size: { width: 360, height: 120 },
    });
    const signatureArea = createNode({
      id: 'signature-area',
      type: 'section',
      name: 'Approval Section',
      parentId: 'page',
      size: { width: 700, height: 260 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, footer, totalsRow, signatureArea].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = resolveSectionParentForInsertion({
      pageNode: page,
      nodesById,
      componentType: 'signature',
      desiredSize: { width: 320, height: 120 },
      preferredSectionId: 'footer',
    });

    expect(picked?.id).toBe('signature-area');
  });

  it('resolves nearest selected section from child context', () => {
    const section = createNode({
      id: 'footer-section',
      type: 'section',
      name: 'Footer',
      childIds: ['footer-column'],
    });
    const column = createNode({
      id: 'footer-column',
      type: 'column',
      parentId: section.id,
      childIds: ['signature-field'],
    });
    const field = createNode({
      id: 'signature-field',
      type: 'field',
      parentId: column.id,
    });

    const nodesById = new Map(
      [section, column, field].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const resolved = findNearestSectionAncestor('signature-field', nodesById);
    expect(resolved).toBe('footer-section');
  });

  it('uses compatible preferred-section descendant parent before global fallback', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer', 'signature-area'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 420, height: 180 },
      childIds: ['totals-row', 'footer-container'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fill',
      },
    });
    const totalsRow = createNode({
      id: 'totals-row',
      type: 'totals',
      parentId: 'footer',
      size: { width: 360, height: 120 },
    });
    const footerContainer = createNode({
      id: 'footer-container',
      type: 'container',
      parentId: 'footer',
      size: { width: 320, height: 140 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 8,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const signatureArea = createNode({
      id: 'signature-area',
      type: 'section',
      name: 'Approval Section',
      parentId: 'page',
      size: { width: 700, height: 260 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, footer, totalsRow, footerContainer, signatureArea].map(
        (node) => [node.id, node] satisfies [string, DesignerNode]
      )
    );

    const picked = resolveSectionParentForInsertion({
      pageNode: page,
      nodesById,
      componentType: 'signature',
      desiredSize: { width: 320, height: 120 },
      preferredSectionId: 'footer',
    });

    expect(picked?.id).toBe('footer-container');
  });

  it('prefers nearest compatible selected ancestor parent when available', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 700, height: 260 },
      childIds: ['notes-container'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 12,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const notesContainer = createNode({
      id: 'notes-container',
      type: 'container',
      parentId: 'footer',
      size: { width: 320, height: 180 },
      childIds: ['notes-label'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 8,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const notesLabel = createNode({
      id: 'notes-label',
      type: 'label',
      parentId: 'notes-container',
      size: { width: 120, height: 24 },
    });

    const nodesById = new Map(
      [page, footer, notesContainer, notesLabel].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const picked = resolvePreferredParentFromSelection({
      selectedNodeId: 'notes-label',
      pageNode: page,
      nodesById,
      componentType: 'signature',
      desiredSize: { width: 320, height: 120 },
    });

    expect(picked?.id).toBe('notes-container');
  });

  it('plans local row reflow inside selected section before inserting', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 736, height: 200 },
      childIds: ['notes', 'totals-area'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 20,
        padding: 20,
        justify: 'space-between',
        align: 'start',
        sizing: 'hug',
      },
    });
    const notes = createNode({
      id: 'notes',
      type: 'container',
      parentId: 'footer',
      size: { width: 140, height: 160 },
      childIds: ['notes-label'],
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 0,
        justify: 'start',
        align: 'stretch',
        sizing: 'fill',
      },
    });
    const notesLabel = createNode({
      id: 'notes-label',
      type: 'label',
      parentId: 'notes',
      size: { width: 100, height: 24 },
    });
    const totalsArea = createNode({
      id: 'totals-area',
      type: 'container',
      parentId: 'footer',
      size: { width: 376, height: 150 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 0,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, footer, notes, notesLabel, totalsArea].map(
        (node) => [node.id, node] satisfies [string, DesignerNode]
      )
    );

    const plan = planForceSelectedInsertion({
      selectedNodeId: 'notes-label',
      pageNode: page,
      nodesById,
      componentType: 'signature',
      desiredSize: { width: 320, height: 120 },
    });

    expect(plan && plan.ok).toBe(true);
    if (!plan || !plan.ok) {
      return;
    }
    expect(plan.parentId).toBe('footer');
    expect(plan.reflowAdjustments.length).toBeGreaterThan(0);
  });

  it('blocks selected section insertion when local reflow limits are exceeded', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 520, height: 200 },
      childIds: ['a', 'b', 'c'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 20,
        padding: 20,
        justify: 'space-between',
        align: 'start',
        sizing: 'hug',
      },
    });
    const a = createNode({ id: 'a', type: 'totals', parentId: 'footer', size: { width: 160, height: 120 } });
    const b = createNode({ id: 'b', type: 'totals', parentId: 'footer', size: { width: 160, height: 120 } });
    const c = createNode({ id: 'c', type: 'totals', parentId: 'footer', size: { width: 160, height: 120 } });

    const nodesById = new Map([page, footer, a, b, c].map((node) => [node.id, node] satisfies [string, DesignerNode]));

    const plan = planForceSelectedInsertion({
      selectedNodeId: 'a',
      pageNode: page,
      nodesById,
      componentType: 'signature',
      desiredSize: { width: 320, height: 120 },
    });

    expect(plan).toEqual({
      ok: false,
      message: 'No room in the selected section. Resize or clear space, then try again.',
      sectionId: 'footer',
      nextAction: 'Resize the selected section, remove nearby blocks, or pick another section.',
    });
  });

  it('uses selected-section descendant parent in forced mode before failing', () => {
    const page = createNode({
      id: 'page',
      type: 'page',
      childIds: ['footer'],
      allowedChildren: ['section'],
    });
    const footer = createNode({
      id: 'footer',
      type: 'section',
      name: 'Footer',
      parentId: 'page',
      size: { width: 360, height: 180 },
      childIds: ['totals', 'footer-box'],
      layout: {
        mode: 'flex',
        direction: 'row',
        gap: 12,
        padding: 12,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });
    const totals = createNode({
      id: 'totals',
      type: 'totals',
      parentId: 'footer',
      size: { width: 300, height: 120 },
    });
    const footerBox = createNode({
      id: 'footer-box',
      type: 'container',
      parentId: 'footer',
      size: { width: 240, height: 140 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 8,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
      },
    });

    const nodesById = new Map(
      [page, footer, totals, footerBox].map((node) => [node.id, node] satisfies [string, DesignerNode])
    );

    const plan = planForceSelectedInsertion({
      selectedNodeId: 'totals',
      pageNode: page,
      nodesById,
      componentType: 'signature',
      desiredSize: { width: 320, height: 120 },
    });

    expect(plan && plan.ok).toBe(true);
    if (!plan || !plan.ok) {
      return;
    }
    expect(plan.parentId).toBe('footer-box');
    expect(plan.reflowAdjustments).toEqual([]);
  });
});
