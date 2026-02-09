import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './state/designerStore';
import { __designerShellTestUtils } from './DesignerShell';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  layout:
    overrides.layout ?? {
      mode: 'canvas',
      direction: 'column',
      gap: 0,
      padding: 0,
      justify: 'start',
      align: 'start',
      sizing: 'fixed',
    },
  parentId: overrides.parentId ?? null,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

describe('DesignerShell section fit utility', () => {
  it('returns null when section has no children', () => {
    const section = createNode({ id: 'section', type: 'section', childIds: [] });
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
      childIds: ['field-a', 'field-b'],
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
      childIds: ['tiny'],
      layout: {
        mode: 'canvas',
        direction: 'column',
        gap: 0,
        padding: 0,
        justify: 'start',
        align: 'start',
        sizing: 'fixed',
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
      childIds: ['field-a'],
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
      childIds: ['field-a'],
      size: { width: 300, height: 220 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 0,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fixed',
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
    const section = createNode({ id: 'section', type: 'section', childIds: ['container'] });
    const container = createNode({
      id: 'container',
      type: 'container',
      parentId: 'section',
      childIds: ['logo'],
    });
    const logo = createNode({
      id: 'logo',
      type: 'logo',
      parentId: 'container',
      childIds: [],
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
    const page = createNode({ id: 'page', type: 'page', childIds: ['logo'] });
    const logo = createNode({
      id: 'logo',
      type: 'logo',
      parentId: 'page',
      childIds: [],
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

  it('returns fill-mode no-op guidance for already fitted sections in fill sizing', () => {
    const fillSection = createNode({
      id: 'section-fill',
      type: 'section',
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 8,
        padding: 16,
        justify: 'start',
        align: 'stretch',
        sizing: 'fill',
      },
    });
    const fixedSection = createNode({
      id: 'section-fixed',
      type: 'section',
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

    expect(__designerShellTestUtils.getSectionFitNoopMessage(fillSection)).toBe(
      'Section is already fitted in Fill mode. Switch section sizing to Fixed to shrink dimensions.'
    );
    expect(__designerShellTestUtils.getSectionFitNoopMessage(fixedSection)).toBe('Section is already fitted.');
  });
});
