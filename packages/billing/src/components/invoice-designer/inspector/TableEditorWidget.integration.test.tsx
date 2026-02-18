// @vitest-environment jsdom

import React, { useMemo } from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignerSchemaInspector } from './DesignerSchemaInspector';
import { DesignCanvas } from '../canvas/DesignCanvas';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};
const tableRootSelector = '[data-automation-id="designer-canvas-node-table-1"]';

const mountTableInspectorAndCanvas = (columns: Array<Record<string, unknown>>) => {
  act(() => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': {
          id: 'doc-1',
          type: 'document',
          props: { name: 'Document', layout: { display: 'flex', flexDirection: 'column' }, style: { width: '816px', height: '1056px' } },
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
          type: 'table',
          props: {
            name: 'Table',
            metadata: {
              columns,
            },
            style: { width: '520px', height: '220px' },
          },
          children: [],
        },
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
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates metadata.columns via schema widget and the canvas preview reflects the change', async () => {
    // Empty columns triggers the canvas fallback headers until we add one via the widget.
    mountTableInspectorAndCanvas([]);
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
    mountTableInspectorAndCanvas([]);

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
    mountTableInspectorAndCanvas([
      { id: 'col-description', header: 'Description', key: 'item.description', type: 'text', width: 280 },
      { id: 'col-quantity', header: 'Qty', key: 'item.quantity', type: 'number', width: 90 },
      { id: 'col-amount', header: 'Amount', key: 'item.total', type: 'currency', width: 140 },
    ]);

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
    mountTableInspectorAndCanvas([
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
    ]);

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
});
