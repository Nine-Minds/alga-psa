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

describe('TableEditorWidget (schema widget integration)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates metadata.columns via schema widget and the canvas preview reflects the change', async () => {
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
                // Empty columns triggers the canvas fallback headers until we add one via the widget.
                columns: [],
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

    const tableRootSelector = '[data-automation-id="designer-canvas-node-table-1"]';
    const initialTableRoot = document.querySelector(tableRootSelector) as HTMLElement | null;
    expect(initialTableRoot).toBeTruthy();
    if (!initialTableRoot) return;

    // Canvas fallback headers for tables with no columns.
    expect(within(initialTableRoot).getByText('Description')).toBeTruthy();

    // Add a column in the Inspector widget.
    const addColumnButton = screen.getByText('Add column');
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
});

