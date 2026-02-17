// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        props: { name: 'Document' },
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        children: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        props: { name: 'Page 1' },
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        children: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        props: { name: 'Section', layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' } },
        position: { x: 24, y: 24 },
        size: { width: 520, height: 200 },
        parentId: 'page-1',
        children: ['container-1'],
        allowedChildren: ['container'],
      },
      {
        id: 'container-1',
        type: 'container',
        props: {
          name: 'Container',
          layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
          style: { width: '50%', height: 'auto' },
        },
        position: { x: 0, y: 0 },
        size: { width: 200, height: 120 },
        parentId: 'section-1',
        children: [],
        allowedChildren: ['text', 'container'],
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

  it('calls onResize with commit=false during pointer-move and commit=true on completion', () => {
    // JSDOM doesn't always provide PointerEvent; DesignCanvas relies on window-level pointer listeners.
    if (typeof (globalThis as any).PointerEvent === 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-extraneous-class
      class MockPointerEvent extends MouseEvent {}
      (globalThis as any).PointerEvent = MockPointerEvent;
    }

    const nodes: DesignerNode[] = [
      {
        id: 'doc-1',
        type: 'document',
        props: { name: 'Document' },
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        children: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        props: { name: 'Page 1' },
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        children: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        props: { name: 'Section', layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' } },
        position: { x: 24, y: 24 },
        size: { width: 520, height: 200 },
        parentId: 'page-1',
        children: ['container-1'],
        allowedChildren: ['container'],
      },
      {
        id: 'container-1',
        type: 'container',
        props: { name: 'Container', layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' } },
        position: { x: 0, y: 0 },
        size: { width: 200, height: 120 },
        parentId: 'section-1',
        children: [],
        allowedChildren: ['text', 'container'],
      },
    ];

    useInvoiceDesignerStore.getState().loadWorkspace({
      nodes,
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    const onResize = vi.fn();

    render(
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
          onResize={onResize}
          readOnly={false}
        />
      </DndContext>
    );

    const container = document.querySelector('[data-automation-id="designer-canvas-node-container-1"]') as
      | HTMLElement
      | null;
    expect(container).toBeTruthy();
    if (!container) return;

    const resizeHandle = container.querySelector('div[role="button"]') as HTMLElement | null;
    expect(resizeHandle).toBeTruthy();
    if (!resizeHandle) return;

    fireEvent.pointerDown(resizeHandle, { clientX: 100, clientY: 100 });
    window.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientX: 120, clientY: 130 }));
    window.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientX: 120, clientY: 130 }));

    const calls = onResize.mock.calls.map((args) => ({
      nodeId: args[0],
      commit: args[2],
    }));

    // At least one in-flight update (commit=false) and one final commit=true update are required.
    expect(calls.some((c) => c.nodeId === 'container-1' && c.commit === false)).toBe(true);
    expect(calls.some((c) => c.nodeId === 'container-1' && c.commit === true)).toBe(true);
  });
});
