// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';
import type { HandleResetSize, HandleResize } from './SelectionAdorner';
import { resolveHandleResizePatch } from '../utils/handleResize';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from '../ast/workspaceAst';
import { createAstDocument, cloneAst } from '../ast/workspaceAst.roundtrip.helpers';

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

  const renderSelected = (onResize: HandleResize, canvasScale = 1, onResetSize: HandleResetSize = noop) => {
    // JSDOM doesn't always provide PointerEvent; the adorner relies on window-level pointer listeners.
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
      canvasScale,
    });

    render(
      <DndContext>
        <DesignCanvas
          nodes={useInvoiceDesignerStore.getState().nodes}
          selectedNodeId="container-1"
          showGuides={false}
          showRulers={false}
          gridSize={8}
          canvasScale={canvasScale}
          snapToGrid={false}
          guides={[]}
          isDragActive={false}
          forcedDropTarget={null}
          droppableId="canvas"
          onPointerLocationChange={noop}
          onNodeSelect={noop}
          onResize={onResize}
          onResetSize={onResetSize}
          readOnly={false}
        />
      </DndContext>
    );
  };

  const drag = (handle: string, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const element = document.querySelector(`[data-automation-id="designer-resize-handle-${handle}"]`) as HTMLElement | null;
    expect(element).toBeTruthy();
    fireEvent.pointerDown(element!, { clientX: from.x, clientY: from.y, button: 0 });
    window.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientX: to.x, clientY: to.y }));
    window.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientX: to.x, clientY: to.y }));
  };

  it('calls onResize with commit=false during pointer-move and commit=true on completion', () => {
    const onResize = vi.fn<HandleResize>();
    renderSelected(onResize);
    drag('se', { x: 100, y: 100 }, { x: 120, y: 130 });

    const commits = onResize.mock.calls.map((args) => ({ nodeId: args[0], commit: args[2] }));
    expect(commits).toEqual([
      { nodeId: 'container-1', commit: false },
      { nodeId: 'container-1', commit: true },
    ]);
  });

  it('changes only the dragged side, by the pointer movement divided by the zoom', () => {
    const onResize = vi.fn<HandleResize>();
    renderSelected(onResize, 2);
    drag('e', { x: 100, y: 100 }, { x: 160, y: 140 });
    // JSDOM boxes measure 0x0, so the width is the movement alone: 60 screen px at 200%.
    expect(onResize).toHaveBeenLastCalledWith('container-1', { width: 30, height: undefined }, true);

    onResize.mockClear();
    drag('s', { x: 100, y: 100 }, { x: 160, y: 140 });
    expect(onResize).toHaveBeenLastCalledWith('container-1', { width: undefined, height: 20 }, true);
  });

  it('keeps side handles a comfortable grab size on a block too short for the corner handles', () => {
    // JSDOM boxes measure 0x0: the shortest block there is.
    renderSelected(vi.fn<HandleResize>());
    const east = document.querySelector('[data-automation-id="designer-resize-handle-e"]') as HTMLElement;
    const south = document.querySelector('[data-automation-id="designer-resize-handle-s"]') as HTMLElement;
    expect(Number.parseFloat(east.style.height)).toBeGreaterThanOrEqual(28);
    expect(Number.parseFloat(south.style.width)).toBeGreaterThanOrEqual(28);
    // Centred on the edge, so there is no dead spot at either end.
    expect(Number.parseFloat(east.style.top)).toBeCloseTo(-Number.parseFloat(east.style.height) / 2);
  });

  it('does not resize (or add an undo step) for a press without movement', () => {
    const onResize = vi.fn<HandleResize>();
    renderSelected(onResize);
    drag('w', { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it('double-clicking a handle sizes that dimension back to its content', () => {
    const onResetSize = vi.fn<HandleResetSize>();
    renderSelected(vi.fn<HandleResize>(), 1, onResetSize);
    fireEvent.doubleClick(document.querySelector('[data-automation-id="designer-resize-handle-e"]')!);
    expect(onResetSize).toHaveBeenLastCalledWith('container-1', { width: true, height: false });
    fireEvent.doubleClick(document.querySelector('[data-automation-id="designer-resize-handle-se"]')!);
    expect(onResetSize).toHaveBeenLastCalledWith('container-1', { width: true, height: true });
  });

  describe('size to content (reset and the Auto detent) in a flow layout', () => {
    const textSelector = '[data-automation-id="designer-canvas-node-text-1"]';
    const textAstId = 'txt';

    const sessionNodes = (): DesignerNode[] => [
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
        children: ['text-1'],
        allowedChildren: ['text'],
      },
      {
        id: 'text-1',
        type: 'text',
        props: { name: 'Text', metadata: { text: 'Hello' }, style: { width: '52px', height: '24px' } },
        position: { x: 0, y: 0 },
        size: { width: 52, height: 24 },
        baseSize: { width: 52, height: 24 },
        parentId: 'section-1',
        children: [],
        allowedChildren: [],
      },
    ];

    const astDocument = () =>
      createAstDocument([
        {
          id: 'sec',
          type: 'section',
          style: { inline: { display: 'flex', flexDirection: 'column' } },
          children: [
            {
              id: textAstId,
              type: 'text',
              content: { type: 'literal', value: 'Hello' },
              style: { inline: { width: '120px', height: '24px' } },
            },
          ],
        },
      ] as any);

    const loadSession = () => useInvoiceDesignerStore.getState().loadWorkspace({
      nodes: sessionNodes(),
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });

    const loadAst = (ast = astDocument()) =>
      useInvoiceDesignerStore.getState().loadWorkspace(importTemplateAstToWorkspace(cloneAst(ast)));

    const saveAst = () => {
      const state = useInvoiceDesignerStore.getState();
      return exportWorkspaceToTemplateAst({
        nodesById: Object.fromEntries(state.nodes.map((node) => [node.id, node])),
        rootId: state.nodes.find((node) => node.type === 'document')?.id,
      } as any);
    };

    const textId = () => useInvoiceDesignerStore.getState().nodes.find((node) => node.type === 'text')!.id;

    // Same sequence DesignerShell runs for a handle gesture.
    const applyHandle = (size: Parameters<typeof resolveHandleResizePatch>[1]) => {
      const store = useInvoiceDesignerStore.getState();
      const id = textId();
      resolveHandleResizePatch(store.nodesById[id], size).forEach((patch) => {
        if (patch.value === null) store.unsetNodeProp(id, patch.path, false);
        else store.setNodeProp(id, patch.path, patch.value, false);
      });
      store.commitHistory();
    };

    const renderedText = () => {
      const element = document.querySelector(`[data-automation-id="designer-canvas-node-${textId()}"]`) as HTMLElement | null;
      expect(element).toBeTruthy();
      return element!;
    };

    const mountCanvas = () => {
      const view = () => (
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
      const { rerender } = render(view());
      return () => rerender(view());
    };

    const scenarios: Array<[string, () => void]> = [
      ['a block created in the session', loadSession],
      ['a block loaded from a saved AST', () => loadAst()],
      [
        'a block reloaded after save',
        () => {
          loadAst();
          applyHandle({ width: 172 });
          loadAst(saveAst());
        },
      ],
    ];

    describe.each(scenarios)('%s', (_label, load) => {
      for (const route of ['reset', 'auto detent'] as const) {
        it(`${route}: renders content-sized with no min-size left from node.size, and undo restores the px size`, () => {
          load();
          const rerender = mountCanvas();

          applyHandle({ width: 172, height: 90 });
          rerender();
          expect(renderedText().style.width).toBe('172px');
          expect(renderedText().style.height).toBe('90px');

          const store = useInvoiceDesignerStore.getState();
          if (route === 'reset') {
            // The reset path: one patch set, one history entry.
            const before = store.historyIndex;
            applyHandle({ width: 'auto', height: 'auto' });
            expect(useInvoiceDesignerStore.getState().historyIndex).toBe(before + 1);
          } else {
            // The detent: repeated 'auto' writes during the drag, committed once on release.
            const before = store.historyIndex;
            applyHandleUncommitted({ width: 'auto' });
            applyHandleUncommitted({ width: 'auto', height: 'auto' });
            useInvoiceDesignerStore.getState().commitHistory();
            expect(useInvoiceDesignerStore.getState().historyIndex).toBe(before + 1);
          }
          rerender();

          const reset = renderedText();
          expect(reset.style.width).toBe('auto');
          expect(reset.style.height).toBe('auto');
          // jsdom has no layout, so "no min-size larger than the content" means none at all.
          expect(reset.style.minWidth).toBe('');
          expect(reset.style.minHeight).toBe('');

          act(() => useInvoiceDesignerStore.getState().undo());
          rerender();
          const undone = renderedText();
          expect(undone.style.width).toBe('172px');
          expect(undone.style.height).toBe('90px');
        });
      }
    });

    const applyHandleUncommitted = (size: Parameters<typeof resolveHandleResizePatch>[1]) => {
      const store = useInvoiceDesignerStore.getState();
      const id = textId();
      resolveHandleResizePatch(store.nodesById[id], size).forEach((patch) => {
        if (patch.value === null) store.unsetNodeProp(id, patch.path, false);
        else store.setNodeProp(id, patch.path, patch.value, false);
      });
    };

    it('survives save and reload: the marker exports as width/height auto and imports with no min-size', () => {
      loadAst();
      const rerender = mountCanvas();
      applyHandle({ width: 172, height: 90 });
      applyHandle({ width: 'auto', height: 'auto' });

      const saved = saveAst();
      const savedText = (saved.layout.children?.[0] as any).children[0];
      expect(savedText.style.inline).toMatchObject({ width: 'auto', height: 'auto' });
      expect(savedText.style.inline.minWidth).toBeUndefined();

      loadAst(saved);
      rerender();
      const reloaded = renderedText();
      expect(reloaded.style.width).toBe('auto');
      expect(reloaded.style.minWidth).toBe('');
      expect(reloaded.style.minHeight).toBe('');
      const node = useInvoiceDesignerStore.getState().nodesById[textId()];
      expect((node.props as any).metadata.__astHadWidth).toBe(true);
    });

    it('keeps an authored min-size that sizes the block when sizing to content', () => {
      loadSession();
      const rerender = mountCanvas();
      const id = textId();
      useInvoiceDesignerStore.getState().unsetNodeProp(id, 'style.width', false);
      useInvoiceDesignerStore.getState().setNodeProp(id, 'style.minWidth', '90px', true);
      applyHandle({ width: 'auto' });
      rerender();
      expect(renderedText().style.minWidth).toBe('90px');
    });
  });
});
