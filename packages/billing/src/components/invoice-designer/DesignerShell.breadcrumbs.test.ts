import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './state/designerStore';
import { __designerShellTestUtils } from './DesignerShell';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  name: overrides.name ?? 'Node',
  props: overrides.props ?? { name: overrides.name ?? 'Node', metadata: {}, layout: overrides.layout, style: overrides.style },
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? overrides.childIds ?? [],
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
  style: overrides.style,
});

describe('DesignerShell breadcrumbs', () => {
  it('computes ancestor path from children-only hierarchy (independent of parentId)', () => {
    const doc = createNode({ id: 'doc', type: 'document', name: 'Document', childIds: ['page'], parentId: null });
    const page = createNode({ id: 'page', type: 'page', name: 'Page 1', childIds: ['section'], parentId: null });
    const section = createNode({ id: 'section', type: 'section', name: 'Section', childIds: ['container'], parentId: null });
    const container = createNode({
      id: 'container',
      type: 'container',
      name: 'Container',
      childIds: ['text'],
      parentId: null,
    });
    const text = createNode({ id: 'text', type: 'text', name: 'Text', childIds: [], parentId: 'WRONG' });

    const nodes = [doc, page, section, container, text];

    expect(__designerShellTestUtils.computeBreadcrumbNodes(nodes, 'text').map((node) => node.name)).toEqual([
      'Page 1',
      'Section',
      'Container',
      'Text',
    ]);

    expect(__designerShellTestUtils.computeBreadcrumbNodes(nodes, 'page').map((node) => node.name)).toEqual(['Page 1']);
    expect(__designerShellTestUtils.computeBreadcrumbNodes(nodes, 'doc')).toEqual([]);
  });
});

