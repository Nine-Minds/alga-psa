import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './state/designerStore';
import { __designerShellTestUtils } from './DesignerShell';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  props:
    overrides.props ??
    ({
      name: overrides.name ?? 'Node',
      metadata: overrides.metadata ?? {},
      layout: overrides.layout,
      style: overrides.style,
    } as any),
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  layout: overrides.layout,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? overrides.childIds ?? [],
  childIds: overrides.childIds ?? overrides.children ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

describe('DesignerShell section fit utility', () => {
  it('returns null when section has no children', () => {
    const section = createNode({ id: 'section', type: 'section', children: [] });
    const size = __designerShellTestUtils.getSectionFitSizeFromChildren(
      section,
      new Map<string, DesignerNode>([['section', section]])
    );

    expect(size).toBeNull();
  });

  it('computes fit size from child extents and includes section flex padding', () => {
    const section = createNode({
      id: 'section',
      type: 'section',
      children: ['field-a', 'field-b'],
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    });
    const fieldA = createNode({
      id: 'field-a',
      type: 'field',
      parentId: 'section',
      position: { x: 20, y: 30 },
      size: { width: 180, height: 40 },
    });
    const fieldB = createNode({
      id: 'field-b',
      type: 'field',
      parentId: 'section',
      position: { x: 12, y: 96 },
      size: { width: 240, height: 60 },
    });

    const size = __designerShellTestUtils.getSectionFitSizeFromChildren(
      section,
      new Map<string, DesignerNode>([
        ['section', section],
        ['field-a', fieldA],
        ['field-b', fieldB],
      ])
    );

    expect(size).toEqual({ width: 268, height: 172 });
  });

  it('respects section minimum size when children are tiny', () => {
    const section = createNode({
      id: 'section',
      type: 'section',
      children: ['tiny'],
      layout: {
        display: 'grid',
        gap: '0px',
        padding: '0px',
      },
    });
    const tiny = createNode({
      id: 'tiny',
      type: 'text',
      parentId: 'section',
      position: { x: 2, y: 2 },
      size: { width: 20, height: 10 },
    });

    const size = __designerShellTestUtils.getSectionFitSizeFromChildren(
      section,
      new Map<string, DesignerNode>([
        ['section', section],
        ['tiny', tiny],
      ])
    );

    expect(size).toEqual({ width: 160, height: 96 });
  });

  it('classifies fit intent as already-fitted when section matches fitted size', () => {
    const section = createNode({
      id: 'section',
      type: 'section',
      children: ['field-a'],
      size: { width: 160, height: 104 },
    });
    const field = createNode({
      id: 'field-a',
      type: 'field',
      parentId: 'section',
      position: { x: 0, y: 0 },
      size: { width: 120, height: 104 },
    });

    const intent = __designerShellTestUtils.getSectionFitIntent(
      section,
      new Map<string, DesignerNode>([
        ['section', section],
        ['field-a', field],
      ])
    );

    expect(intent).toEqual({ status: 'already-fitted' });
  });

  it('classifies fit intent as fit-needed when section has extra whitespace', () => {
    const section = createNode({
      id: 'section',
      type: 'section',
      children: ['field-a'],
      size: { width: 300, height: 220 },
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    });
    const field = createNode({
      id: 'field-a',
      type: 'field',
      parentId: 'section',
      position: { x: 20, y: 24 },
      size: { width: 180, height: 40 },
    });

    const intent = __designerShellTestUtils.getSectionFitIntent(
      section,
      new Map<string, DesignerNode>([
        ['section', section],
        ['field-a', field],
      ])
    );

    expect(intent).toEqual({
      status: 'fit-needed',
      size: { width: 216, height: 96 },
    });
  });

  it('resolves nearest ancestor section for media selection', () => {
    const section = createNode({ id: 'section', type: 'section', children: ['container'] });
    const container = createNode({
      id: 'container',
      type: 'container',
      parentId: 'section',
      children: ['logo'],
    });
    const logo = createNode({
      id: 'logo',
      type: 'logo',
      parentId: 'container',
      children: [],
    });

    const resolved = __designerShellTestUtils.resolveNearestAncestorSection(
      'logo',
      new Map<string, DesignerNode>([
        ['section', section],
        ['container', container],
        ['logo', logo],
      ])
    );

    expect(resolved?.id).toBe('section');
  });

  it('returns null when media has no ancestor section', () => {
    const page = createNode({ id: 'page', type: 'page', children: ['logo'] });
    const logo = createNode({
      id: 'logo',
      type: 'logo',
      parentId: 'page',
      children: [],
    });

    const resolved = __designerShellTestUtils.resolveNearestAncestorSection(
      'logo',
      new Map<string, DesignerNode>([
        ['page', page],
        ['logo', logo],
      ])
    );

    expect(resolved).toBeNull();
  });

  it('reports clamp transparency when resolved size differs from draft', () => {
    expect(
      __designerShellTestUtils.wasSizeConstrainedFromDraft(
        { width: 900, height: 600 },
        { width: 320, height: 200 }
      )
    ).toBe(true);
    expect(
      __designerShellTestUtils.wasSizeConstrainedFromDraft(
        { width: 320, height: 200 },
        { width: 320, height: 200 }
      )
    ).toBe(false);
  });

  it('returns already-fitted guidance for sections', () => {
    const fillSection = createNode({
      id: 'section-fill',
      type: 'section',
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    });
    const fixedSection = createNode({
      id: 'section-fixed',
      type: 'section',
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    });

    expect(__designerShellTestUtils.getSectionFitNoopMessage(fillSection)).toBe('Section is already fitted.');
    expect(__designerShellTestUtils.getSectionFitNoopMessage(fixedSection)).toBe('Section is already fitted.');
  });

  it('promotes flex parent to canvas when label gets manual x/y edits', () => {
    const label = createNode({
      id: 'label-1',
      type: 'label',
      parentId: 'container-1',
      position: { x: 24, y: 24 },
      metadata: { text: 'Label' },
    });
    const flexParent = createNode({
      id: 'container-1',
      type: 'container',
      layout: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '16px',
        justifyContent: 'flex-start',
        alignItems: 'stretch',
      },
    });

    expect(
      __designerShellTestUtils.shouldPromoteParentToCanvasForManualPosition(label, flexParent, {
        x: 120,
        y: 96,
      })
    ).toBe(true);
    expect(
      __designerShellTestUtils.shouldPromoteParentToCanvasForManualPosition(label, flexParent, {
        x: 24,
        y: 24,
      })
    ).toBe(false);
  });

  it('does not promote parent layout for non-label nodes or non-flex parents', () => {
    const text = createNode({
      id: 'text-1',
      type: 'text',
      parentId: 'container-1',
      position: { x: 24, y: 24 },
    });
    const canvasParent = createNode({
      id: 'container-1',
      type: 'container',
      layout: {
        display: 'grid',
        gap: '0px',
        padding: '0px',
      },
    });

    expect(
      __designerShellTestUtils.shouldPromoteParentToCanvasForManualPosition(text, canvasParent, {
        x: 120,
        y: 96,
      })
    ).toBe(false);
  });

});
