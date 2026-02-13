// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas (resize integration)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates DOM sizing when resizing writes style.width/style.height via setNodeProp', () => {
    const nodes: DesignerNode[] = [
      {
        id: 'doc-1',
        type: 'document',
        name: 'Document',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        childIds: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        name: 'Page 1',
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        childIds: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        name: 'Section',
        position: { x: 24, y: 24 },
        size: { width: 520, height: 200 },
        parentId: 'page-1',
        childIds: ['container-1'],
        allowedChildren: ['container'],
        layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
      },
      {
        id: 'container-1',
        type: 'container',
        name: 'Container',
        position: { x: 0, y: 0 },
        size: { width: 200, height: 120 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: ['text', 'container'],
        layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
        style: { width: '50%', height: 'auto' },
      },
    ];

    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    const { rerender } = render(
      <DndContext>
        <DesignCanvas
          nodes={useInvoiceDesignerStore.getState().nodes}
          selectedNodeId={null}
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
          readOnly={false}
        />
      </DndContext>
    );

    const before = document.querySelector('[data-automation-id="designer-canvas-node-container-1"]') as HTMLElement | null;
    expect(before).toBeTruthy();
    if (!before) return;
    expect(before.style.width).toBe('50%');
    expect(before.style.height).toBe('auto');

    // Simulate resize writes through the generic patch API (same shape used by DesignerShell).
    store.setNodeProp('container-1', 'style.width', '200px', false);
    store.setNodeProp('container-1', 'style.height', '160px', true);

    rerender(
      <DndContext>
        <DesignCanvas
          nodes={useInvoiceDesignerStore.getState().nodes}
          selectedNodeId={null}
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
          readOnly={false}
        />
      </DndContext>
    );

    const after = document.querySelector('[data-automation-id="designer-canvas-node-container-1"]') as HTMLElement | null;
    expect(after).toBeTruthy();
    if (!after) return;
    expect(after.style.width).toBe('200px');
    expect(after.style.height).toBe('160px');
  });
});

