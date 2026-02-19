import { describe, expect, it } from 'vitest';

import type { DesignerNode } from './state/designerStore';
import { __designerShellTestUtils } from './DesignerShell';
import { getNodeName } from './utils/nodeProps';

const createNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: overrides.id ?? `node-${Math.random().toString(36).slice(2, 7)}`,
  type: overrides.type ?? 'text',
  props: overrides.props ?? { name: 'Node', metadata: {}, layout: undefined, style: undefined },
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 48 },
  baseSize: overrides.baseSize ?? overrides.size ?? { width: 120, height: 48 },
  canRotate: overrides.canRotate ?? false,
  allowResize: overrides.allowResize ?? true,
  rotation: overrides.rotation ?? 0,
  layoutPresetId: overrides.layoutPresetId,
  parentId: overrides.parentId ?? null,
  children: overrides.children ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
});

describe('DesignerShell breadcrumbs', () => {
  it('computes ancestor path from children-only hierarchy (independent of parentId)', () => {
    const doc = createNode({ id: 'doc', type: 'document', props: { name: 'Document', metadata: {} }, children: ['page'], parentId: null });
    const page = createNode({ id: 'page', type: 'page', props: { name: 'Page 1', metadata: {} }, children: ['section'], parentId: null });
    const section = createNode({ id: 'section', type: 'section', props: { name: 'Section', metadata: {} }, children: ['container'], parentId: null });
    const container = createNode({
      id: 'container',
      type: 'container',
      props: { name: 'Container', metadata: {} },
      children: ['text'],
      parentId: null,
    });
    const text = createNode({ id: 'text', type: 'text', props: { name: 'Text', metadata: {} }, children: [], parentId: 'WRONG' });

    const nodes = [doc, page, section, container, text];

    expect(__designerShellTestUtils.computeBreadcrumbNodes(nodes, 'text').map((node) => getNodeName(node))).toEqual([
      'Page 1',
      'Section',
      'Container',
      'Text',
    ]);

    expect(__designerShellTestUtils.computeBreadcrumbNodes(nodes, 'page').map((node) => getNodeName(node))).toEqual(['Page 1']);
    expect(__designerShellTestUtils.computeBreadcrumbNodes(nodes, 'doc')).toEqual([]);
  });
});
