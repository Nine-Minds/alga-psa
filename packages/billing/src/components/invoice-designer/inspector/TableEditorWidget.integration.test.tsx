// @vitest-environment jsdom

import React, { useMemo } from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignerSchemaInspector } from './DesignerSchemaInspector';
import { exportWorkspaceToTemplateAst } from '../ast/workspaceAst';
import { DesignCanvas } from '../canvas/DesignCanvas';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';
import { buildQuoteTemplateBindings } from '../../../lib/quote-template-ast/bindings';

afterEach(() => cleanup());

const noop = () => {};
const tableRootSelector = '[data-automation-id="designer-canvas-node-table-1"]';

const findDynamicTableNode = (node: any): any | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (node.type === 'dynamic-table') {
    return node;
  }
  if (!Array.isArray(node.children)) {
    return null;
  }
  for (const child of node.children) {
    const match = findDynamicTableNode(child);
    if (match) {
      return match;
    }
  }
  return null;
};

const selectCustomOption = async (triggerId: string, optionText: string) => {
  const trigger = document.getElementById(triggerId);
  expect(trigger).toBeTruthy();
  if (!trigger) return;
  act(() => {
    fireEvent.click(trigger);
  });
  const options = await screen.findAllByRole('option');
  const option = options.find((candidate) => candidate.textContent?.trim() === optionText) ?? null;
  expect(option).toBeTruthy();
  if (!option) return;
  act(() => {
    fireEvent.click(option);
  });
};

const mountTableInspectorAndCanvas = ({
  columns,
  nodeType = 'table',
  sourceBindingId,
  documentMetadata,
  transforms,
}: {
  columns: Array<Record<string, unknown>>;
  nodeType?: 'table' | 'dynamic-table';
  sourceBindingId?: string;
  documentMetadata?: Record<string, unknown>;
  transforms?: {
    sourceBindingId: string;
    outputBindingId: string;
    operations: Array<Record<string, unknown>>;
  };
}) => {
  act(() => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': {
          id: 'doc-1',
          type: 'document',
          props: {
            name: 'Document',
            metadata: documentMetadata ?? {},
            layout: { display: 'flex', flexDirection: 'column' },
            style: { width: '816px', height: '1056px' },
          },
          children: ['page-1'],
        },
        'page-1': {
          id: 'page-1',
          type: 'page',
          props: { name: 'Page 1', layout: { display: 'flex', flexDirection: 'column' }, style: { width: '816px', height: '1056px' } },
          children: ['section-1'],
        },
        'section-1': {
          id: 'section-1',
          type: 'section',
          props: {
            name: 'Section',
            metadata: {},
            layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
            style: { width: '600px', height: '400px' },
          },
          children: ['table-1'],
        },
        'table-1': {
          id: 'table-1',
          type: nodeType,
          props: {
            name: 'Table',
            metadata: {
              columns,
              ...(sourceBindingId ? { collectionBindingKey: sourceBindingId } : {}),
            },
            style: { width: '520px', height: '220px' },
          },
          children: [],
        },
      },
      transforms: transforms
        ? {
            sourceBindingId: transforms.sourceBindingId,
            outputBindingId: transforms.outputBindingId,
            operations: transforms.operations as any,
          }
        : {
            sourceBindingId: '',
            outputBindingId: '',
            operations: [],
          },
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });
    store.selectNode('table-1');
  });

  const Wrapper: React.FC = () => {
    const nodes = useInvoiceDesignerStore((state) => state.nodes);
    const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
    const node = useInvoiceDesignerStore((state) =>
      selectedNodeId ? (state.nodesById[selectedNodeId] as DesignerNode | undefined) : undefined
    );
    const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);

    return (
      <div>
        {node ? <DesignerSchemaInspector node={node} nodesById={nodesById} /> : null}
        <DndContext>
          <DesignCanvas
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            showGuides={false}
            showRulers={false}
            gridSize={8}
            canvasScale={1}
            snapToGrid={false}
            guides={[]}
            isDragActive={false}
            forcedDropTarget={null}
            droppableId="canvas"
            onPointerLocationChange={noop}
            onNodeSelect={noop}
            onResize={noop}
            readOnly={true}
          />
        </DndContext>
      </div>
    );
  };

  render(<Wrapper />);
};

describe('TableEditorWidget (schema widget integration)', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => undefined,
    });
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates metadata.columns via schema widget and the canvas preview reflects the change', async () => {
    // Empty columns triggers the canvas fallback headers until we add one via the widget.
    mountTableInspectorAndCanvas({ columns: [] });
    const initialTableRoot = document.querySelector(tableRootSelector) as HTMLElement | null;
    expect(initialTableRoot).toBeTruthy();
    if (!initialTableRoot) return;

    // Canvas fallback headers for tables with no columns.
    expect(within(initialTableRoot).getByText('Description')).toBeTruthy();

    // Add a column in the Inspector widget.
    const addColumnButton = screen.getByText('+ Column');
    fireEvent.click(addColumnButton);

    // Widget writes to metadata.columns, which should now drive the canvas header.
    await waitFor(() => {
      const tableRoot = document.querySelector(tableRootSelector) as HTMLElement | null;
      expect(tableRoot).toBeTruthy();
      if (!tableRoot) return;
      expect(within(tableRoot).getByText('New Column')).toBeTruthy();
    });

    const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
    const columns = (updated.props as any)?.metadata?.columns;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBe(1);
  });

  it('quick add presets provide guided column creation and legend hints', async () => {
    mountTableInspectorAndCanvas({ columns: [] });

    expect(screen.getByText('Field key reference')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Description' }));
    fireEvent.click(screen.getByRole('button', { name: 'Amount' }));

    await waitFor(() => {
      const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
      const columns = (updated.props as any)?.metadata?.columns;
      expect(Array.isArray(columns)).toBe(true);
      expect(columns.length).toBe(2);
      expect(columns[0]).toMatchObject({
        header: 'Description',
        key: 'item.description',
        type: 'text',
      });
      expect(columns[1]).toMatchObject({
        header: 'Amount',
        key: 'item.total',
        type: 'currency',
      });
    });
  });

  it('reorders columns with move up/down controls', async () => {
    mountTableInspectorAndCanvas({ columns: [
      { id: 'col-description', header: 'Description', key: 'item.description', type: 'text', width: 280 },
      { id: 'col-quantity', header: 'Qty', key: 'item.quantity', type: 'number', width: 90 },
      { id: 'col-amount', header: 'Amount', key: 'item.total', type: 'currency', width: 140 },
    ] });

    fireEvent.click(screen.getByRole('button', { name: 'Move col-quantity up' }));

    await waitFor(() => {
      const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
      const columns = (updated.props as any)?.metadata?.columns;
      expect(columns.map((column: any) => column.id)).toEqual(['col-quantity', 'col-description', 'col-amount']);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move col-quantity down' }));

    await waitFor(() => {
      const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
      const columns = (updated.props as any)?.metadata?.columns;
      expect(columns.map((column: any) => column.id)).toEqual(['col-description', 'col-quantity', 'col-amount']);
    });
  });

  it('reorders columns that include undefined optional metadata from AST imports', async () => {
    mountTableInspectorAndCanvas({ columns: [
      {
        id: 'description',
        header: 'Description',
        key: 'item.description',
        type: undefined,
        format: undefined,
        style: undefined,
      },
      {
        id: 'quantity',
        header: 'Qty',
        key: 'item.quantity',
        type: 'number',
        format: 'number',
        style: { inline: { textAlign: 'right' } },
      },
      {
        id: 'line-total',
        header: 'Amount',
        key: 'item.total',
        type: 'currency',
        format: 'currency',
        style: { inline: { textAlign: 'right' } },
      },
    ] });

    fireEvent.click(screen.getByRole('button', { name: 'Move quantity up' }));

    await waitFor(() => {
      const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
      const columns = (updated.props as any)?.metadata?.columns;
      expect(columns.map((column: any) => column.id)).toEqual(['quantity', 'description', 'line-total']);
      expect(Object.prototype.hasOwnProperty.call(columns[1], 'type')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(columns[1], 'format')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(columns[1], 'style')).toBe(false);
    });
  });

  it('lets dynamic tables switch their source binding to the authored transforms output binding', async () => {
    mountTableInspectorAndCanvas({
      nodeType: 'dynamic-table',
      sourceBindingId: 'items',
      columns: [{ id: 'col-description', header: 'Description', key: 'item.description', type: 'text', width: 280 }],
      transforms: {
        sourceBindingId: 'items',
        outputBindingId: 'items.grouped',
        operations: [
          { id: 'group-category', type: 'group', key: 'category', label: 'Category' },
          { id: 'aggregate-sum', type: 'aggregate', aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }] },
        ],
      },
    });

    await selectCustomOption('designer-table-source-binding', 'items.grouped (Transforms output)');

    await waitFor(() => {
      const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
      expect((updated.props as any)?.metadata?.collectionBindingKey).toBe('items.grouped');
    });

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    const table = findDynamicTableNode(ast.layout);
    expect(table?.type).toBe('dynamic-table');
    if (!table || table.type !== 'dynamic-table') return;
    expect(table.repeat.sourceBinding.bindingId).toContain('items.grouped');
  });

  it('offers grouped transform row paths in the column mapping UI when the transforms output binding is selected', async () => {
    mountTableInspectorAndCanvas({
      nodeType: 'dynamic-table',
      sourceBindingId: 'items.grouped',
      columns: [{ id: 'col-description', header: 'Description', key: 'item.description', type: 'text', width: 280 }],
      transforms: {
        sourceBindingId: 'items',
        outputBindingId: 'items.grouped',
        operations: [
          { id: 'group-category', type: 'group', key: 'category', label: 'Category' },
          { id: 'aggregate-sum', type: 'aggregate', aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }] },
        ],
      },
    });

    expect(screen.getAllByText('item.key').length).toBeGreaterThan(0);
    expect(screen.getAllByText('item.aggregates.sumTotal').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'item.description' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'item.unitPrice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Description' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rate' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'item.aggregates.sumTotal' })[0]!);

    await waitFor(() => {
      const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
      const columns = (updated.props as any)?.metadata?.columns;
      expect(columns[0]?.key).toBe('item.aggregates.sumTotal');
    });
  });

  it('refreshes available column mapping suggestions when the table source binding changes shape', async () => {
    mountTableInspectorAndCanvas({
      nodeType: 'dynamic-table',
      sourceBindingId: 'items.grouped',
      columns: [{ id: 'col-description', header: 'Description', key: 'item.description', type: 'text', width: 280 }],
      transforms: {
        sourceBindingId: 'items',
        outputBindingId: 'items.grouped',
        operations: [
          { id: 'group-category', type: 'group', key: 'category', label: 'Category' },
          { id: 'aggregate-sum', type: 'aggregate', aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }] },
        ],
      },
    });

    expect(screen.getAllByText('item.aggregates.sumTotal').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Description' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'item.description' })).toBeNull();

    await selectCustomOption('designer-table-source-binding', 'items (Transforms source)');

    await waitFor(() => {
      expect(screen.queryAllByText('item.aggregates.sumTotal')).toHaveLength(0);
      expect(screen.getAllByText('item.description').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Description' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'item.description' })).toBeTruthy();
    });
  });

  it('lists recurring, one-time, service, and product quote collections in the table source dropdown when quote bindings are imported', async () => {
    mountTableInspectorAndCanvas({
      nodeType: 'dynamic-table',
      sourceBindingId: 'lineItems',
      documentMetadata: {
        __astBindingCatalog: buildQuoteTemplateBindings(),
      },
      columns: [{ id: 'col-description', header: 'Description', key: 'item.description', type: 'text', width: 280 }],
    });

    const trigger = document.getElementById('designer-table-source-binding');
    expect(trigger).toBeTruthy();
    if (!trigger) return;

    fireEvent.click(trigger);

    const options = await screen.findAllByRole('option');
    const optionLabels = options.map((option) => option.textContent?.trim());

    expect(optionLabels).toContain('Recurring Items');
    expect(optionLabels).toContain('One-time Items');
    expect(optionLabels).toContain('Service Items');
    expect(optionLabels).toContain('Product Items');
  });
});
