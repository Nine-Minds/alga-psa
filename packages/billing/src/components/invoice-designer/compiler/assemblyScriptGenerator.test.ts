import { describe, expect, it } from 'vitest';
import type { DesignerNode, DesignerWorkspaceSnapshot } from '../state/designerStore';
import { extractInvoiceDesignerIr } from './guiIr';
import { generateAssemblyScriptFromIr } from './assemblyScriptGenerator';

const createNode = (
  id: string,
  type: DesignerNode['type'],
  parentId: string | null,
  overrides: Partial<DesignerNode> = {}
): DesignerNode => ({
  id,
  type,
  name: overrides.name ?? `${type}-${id}`,
  position: overrides.position ?? { x: 0, y: 0 },
  size: overrides.size ?? { width: 120, height: 40 },
  canRotate: false,
  rotation: 0,
  allowResize: true,
  metadata: overrides.metadata ?? {},
  layoutPresetId: overrides.layoutPresetId,
  parentId,
  childIds: overrides.childIds ?? [],
  allowedChildren: overrides.allowedChildren ?? [],
  layout: overrides.layout,
});

const createWorkspace = (nodes: DesignerNode[]): DesignerWorkspaceSnapshot => ({
  nodes,
  constraints: [],
  snapToGrid: true,
  gridSize: 8,
  showGuides: true,
  showRulers: true,
  canvasScale: 1,
});

describe('generateAssemblyScriptFromIr', () => {
  it('produces deterministic source for equivalent workspace models', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['section-main'] });
    const sectionNodeA = createNode('section-main', 'section', 'page', {
      childIds: ['field-number', 'label-number'],
      metadata: { zeta: 1, alpha: 2 },
    });
    const fieldNode = createNode('field-number', 'field', 'section-main', {
      metadata: { format: 'text', bindingKey: 'invoice.number' },
    });
    const labelNodeA = createNode('label-number', 'label', 'section-main', {
      metadata: { text: 'Invoice Number' },
    });

    const sectionNodeB = createNode('section-main', 'section', 'page', {
      childIds: ['field-number', 'label-number'],
      metadata: { alpha: 2, zeta: 1 },
    });
    const labelNodeB = createNode('label-number', 'label', 'section-main', {
      metadata: { text: 'Invoice Number' },
    });

    const workspaceA = createWorkspace([documentNode, pageNode, sectionNodeA, fieldNode, labelNodeA]);
    const workspaceB = createWorkspace([labelNodeB, fieldNode, sectionNodeB, pageNode, documentNode]);

    const sourceA = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspaceA));
    const sourceB = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspaceB));

    expect(sourceA.source).toBe(sourceB.source);
    expect(sourceA.sourceHash).toBe(sourceB.sourceHash);
    expect(sourceA.sourceMap.map((entry) => entry.nodeId)).toEqual(sourceB.sourceMap.map((entry) => entry.nodeId));
  });

  it('emits source map entries linked to generated node factory symbols', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['text-1'] });
    const textNode = createNode('text-1', 'text', 'page', {
      metadata: { text: 'Hello Preview' },
    });
    const workspace = createWorkspace([documentNode, pageNode, textNode]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('export function generateLayout');
    expect(generated.source).toContain('function createNode_doc');
    expect(generated.sourceMap).toHaveLength(3);
    generated.sourceMap.forEach((entry) => {
      expect(entry.startLine).toBeGreaterThan(0);
      expect(entry.endLine).toBeGreaterThanOrEqual(entry.startLine);
      expect(entry.symbol).toContain('createNode_');
    });
  });

  it('emits field, table, and totals binding logic from GUI metadata', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['field-1', 'table-1', 'totals-row-1'] });
    const fieldNode = createNode('field-1', 'field', 'page', {
      metadata: { bindingKey: 'customer.name', format: 'text' },
    });
    const tableNode = createNode('table-1', 'table', 'page', {
      metadata: {
        columns: [
          { header: 'Description', key: 'item.description', type: 'text' },
          { header: 'Amount', key: 'item.total', type: 'currency' },
        ],
      },
    });
    const totalsRowNode = createNode('totals-row-1', 'custom-total', 'page', {
      metadata: { label: 'Amount Due', bindingKey: 'invoice.total', format: 'currency' },
    });
    const workspace = createWorkspace([documentNode, pageNode, fieldNode, tableNode, totalsRowNode]);

    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('function resolveInvoiceBinding');
    expect(generated.source).toContain('resolveInvoiceBinding(viewModel, "customer.name", "text")');
    expect(generated.source).toContain('function resolveItemBinding');
    expect(generated.source).toContain('resolveItemBinding(viewModel, rowItem, "item.total", "currency")');
    expect(generated.source).toContain('Amount Due: " + resolveInvoiceBinding(viewModel, "invoice.total", "currency")');
  });

  it('emits layout/style declarations derived from node size, position, and layout metadata', () => {
    const documentNode = createNode('doc', 'document', null, { childIds: ['page'] });
    const pageNode = createNode('page', 'page', 'doc', { childIds: ['section-1'] });
    const sectionNode = createNode('section-1', 'section', 'page', {
      position: { x: 32, y: 48 },
      size: { width: 640, height: 300 },
      layout: {
        mode: 'flex',
        direction: 'column',
        gap: 14,
        padding: 20,
        justify: 'space-between',
        align: 'center',
        sizing: 'hug',
      },
      childIds: ['field-1'],
    });
    const fieldNode = createNode('field-1', 'field', 'section-1', {
      position: { x: 12, y: 16 },
      size: { width: 320, height: 48 },
      metadata: { bindingKey: 'invoice.number' },
    });

    const workspace = createWorkspace([documentNode, pageNode, sectionNode, fieldNode]);
    const generated = generateAssemblyScriptFromIr(extractInvoiceDesignerIr(workspace));

    expect(generated.source).toContain('function applyGeneratedLayoutStyle');
    expect(generated.source).toContain('layout-mode:flex; sizing:hug');
    expect(generated.source).toContain('applyGeneratedLayoutStyle(node, 640, 300, 32, 48, 14, 20, "center", "space-between")');
    expect(generated.source).toContain('applyGeneratedLayoutStyle(node, 320, 48, 12, 16, 0, 0, "start", "start")');
  });

  it('matches deterministic golden snapshots for representative design fixtures', () => {
    const fixtureSimple = createWorkspace([
      createNode('doc', 'document', null, { childIds: ['page'] }),
      createNode('page', 'page', 'doc', { childIds: ['field-1', 'label-1'] }),
      createNode('field-1', 'field', 'page', { metadata: { bindingKey: 'invoice.number', format: 'text' } }),
      createNode('label-1', 'label', 'page', { metadata: { text: 'Invoice #' } }),
    ]);
    const fixtureTableTotals = createWorkspace([
      createNode('doc', 'document', null, { childIds: ['page'] }),
      createNode('page', 'page', 'doc', { childIds: ['table-1', 'totals-1'] }),
      createNode('table-1', 'table', 'page', {
        metadata: {
          columns: [
            { header: 'Desc', key: 'item.description', type: 'text' },
            { header: 'Amount', key: 'item.total', type: 'currency' },
          ],
        },
      }),
      createNode('totals-1', 'custom-total', 'page', {
        metadata: { label: 'Amount Due', bindingKey: 'invoice.total', format: 'currency' },
      }),
    ]);

    const golden = [
      {
        name: 'simple-field-label',
        generated: generateAssemblyScriptFromIr(extractInvoiceDesignerIr(fixtureSimple)),
      },
      {
        name: 'table-and-total',
        generated: generateAssemblyScriptFromIr(extractInvoiceDesignerIr(fixtureTableTotals)),
      },
    ].map((entry) => ({
      name: entry.name,
      sourceHash: entry.generated.sourceHash,
      sourcePreview: entry.generated.source.split('\n').slice(0, 20).join('\n'),
    }));

    expect(golden).toMatchSnapshot();
  });
});
