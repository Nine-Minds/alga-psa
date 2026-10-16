// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';
import { HANDLE_ARM_DELAY_MS } from './SelectionAdorner';
import type { HandleResetSize, HandleResize } from './SelectionAdorner';
import { resolveHandleResizePatch } from '../utils/handleResize';
import { exportWorkspaceToTemplateAst, importTemplateAstToWorkspace } from '../ast/workspaceAst';
import { createAstDocument, cloneAst } from '../ast/workspaceAst.roundtrip.helpers';

afterEach(() => {
  cleanup();
  // A resize drag registers a window click-swallow that removes itself on a timeout; flush it
  // so it cannot swallow the next test's click when the timers were faked.
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

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

    // Handles of a freshly mounted adorner are dormant until the double-click interval
    // has passed; these tests exercise handles of an already-selected block.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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
    act(() => {
      vi.advanceTimersByTime(HANDLE_ARM_DELAY_MS);
    });
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

  describe('selecting a block with a press that lands near its edge', () => {
    const handleSelector = (handle: string) => `[data-automation-id="designer-resize-handle-${handle}"]`;
    const textSelector = '[data-automation-id="designer-canvas-node-text-1"]';
    const viewportSelector = '[data-designer-canvas-viewport="true"]';

    const edgeNodes = (): DesignerNode[] => [
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
        props: { name: 'Text', metadata: { text: 'Hello' }, style: { width: '120px', height: '24px' } },
        position: { x: 0, y: 0 },
        size: { width: 120, height: 24 },
        baseSize: { width: 120, height: 24 },
        parentId: 'section-1',
        children: [],
        allowedChildren: [],
      },
    ];

    // Mirrors the shell: selection lives in state, so an onNodeSelect(null) really deselects.
    const mountSelectable = (initialSelected: string | null) => {
      if (typeof (globalThis as any).PointerEvent === 'undefined') {
        class MockPointerEvent extends MouseEvent {}
        (globalThis as any).PointerEvent = MockPointerEvent;
      }
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      useInvoiceDesignerStore.getState().loadWorkspace({
        nodes: edgeNodes(),
        snapToGrid: false,
        gridSize: 8,
        showGuides: false,
        showRulers: false,
        canvasScale: 1,
      });
      const selections: Array<string | null> = [];
      const onResize = vi.fn<HandleResize>();
      const onResetSize = vi.fn<HandleResetSize>();
      const onTextEdit = vi.fn();
      const Harness = () => {
        const [selected, setSelected] = React.useState<string | null>(initialSelected);
        return (
          <DndContext>
            <DesignCanvas
              nodes={useInvoiceDesignerStore.getState().nodes}
              selectedNodeId={selected}
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
              onNodeSelect={(id) => {
                selections.push(id);
                setSelected(id);
              }}
              onResize={onResize}
              onResetSize={onResetSize}
              onTextEdit={onTextEdit}
              readOnly={false}
            />
          </DndContext>
        );
      };
      render(<Harness />);
      const text = () => document.querySelector(textSelector) as HTMLElement;
      const handle = (name: string) => document.querySelector(handleSelector(name)) as HTMLElement;
      const viewport = () => document.querySelector(viewportSelector) as HTMLElement;
      const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
      const lastSelection = () => selections[selections.length - 1];
      return { selections, onResize, onResetSize, onTextEdit, text, handle, viewport, advance, lastSelection };
    };

    it('keeps the block selected when the release lands on the fresh handle and the click retargets to the viewport', () => {
      const view = mountSelectable(null);
      expect(view.handle('s')).toBeNull();

      fireEvent.pointerDown(view.text(), { button: 0, clientX: 4, clientY: 20 });
      expect(view.lastSelection()).toBe('text-1');

      // The adorner is mounted now; its handles are dormant for this selection.
      expect(view.handle('s').getAttribute('data-armed')).toBe('false');
      expect(view.handle('s').style.pointerEvents).toBe('none');
      expect(view.handle('w').style.pointerEvents).toBe('none');

      fireEvent.pointerUp(view.handle('s'), { button: 0 });
      fireEvent.click(view.handle('s'));
      // jsdom does not hit-test: real browsers deliver the click to the common ancestor.
      fireEvent.click(view.viewport());

      expect(view.selections).toEqual(['text-1']);
      expect(view.selections).not.toContain(null);
      expect(view.handle('s')).toBeTruthy();
    });

    it('keeps the block selected when the press itself starts on a handle (a drag-resize end)', () => {
      const view = mountSelectable('text-1');
      view.advance(HANDLE_ARM_DELAY_MS);
      fireEvent.pointerDown(view.handle('s'), { button: 0, clientX: 4, clientY: 20 });
      fireEvent.pointerUp(view.handle('s'), { button: 0 });
      fireEvent.click(view.viewport());
      expect(view.selections).not.toContain(null);
    });

    it('still deselects when the press starts on empty canvas', () => {
      const view = mountSelectable('text-1');
      view.advance(HANDLE_ARM_DELAY_MS);
      fireEvent.pointerDown(view.viewport(), { button: 0 });
      fireEvent.pointerUp(view.viewport(), { button: 0 });
      fireEvent.click(view.viewport());
      expect(view.lastSelection()).toBeNull();
      expect(view.handle('s')).toBeNull();
    });

    it('does not let an earlier press on a block suppress a later click with no pointerdown', () => {
      const view = mountSelectable(null);
      fireEvent.pointerDown(view.text(), { button: 0 });
      fireEvent.click(view.viewport());
      expect(view.selections).toEqual(['text-1']);
      // e.g. a programmatic click: no press behind it, so it is an empty-canvas click.
      fireEvent.click(view.viewport());
      expect(view.lastSelection()).toBeNull();
    });

    it('enters inline text edit on a double-click at the edge and does not reset the size', () => {
      const view = mountSelectable(null);
      // First press selects the block; the release lands on the (dormant) south handle.
      fireEvent.pointerDown(view.text(), { button: 0, clientX: 40, clientY: 22 });
      fireEvent.pointerUp(view.handle('s'), { button: 0 });
      fireEvent.click(view.viewport());
      view.advance(120);
      // Second press, inside the double-click interval: the handle is still dormant, so the
      // press and the dblclick belong to the block.
      expect(view.handle('s').style.pointerEvents).toBe('none');
      fireEvent.pointerDown(view.text(), { button: 0, clientX: 40, clientY: 22 });
      fireEvent.doubleClick(view.text());
      // A browser would not deliver the dblclick to a dormant handle; the logic also refuses it.
      fireEvent.doubleClick(view.handle('s'));

      expect(document.querySelector('textarea')).toBeTruthy();
      expect(view.onResetSize).not.toHaveBeenCalled();
      expect(view.selections).not.toContain(null);
    });

    it('arms the handles only once the selecting press is released and the double-click interval has passed', () => {
      const view = mountSelectable(null);
      fireEvent.pointerDown(view.text(), { button: 0 });
      view.advance(HANDLE_ARM_DELAY_MS - 50);
      fireEvent.pointerUp(view.text(), { button: 0 });
      view.advance(HANDLE_ARM_DELAY_MS - 1);
      expect(view.handle('s').getAttribute('data-armed')).toBe('false');
      view.advance(1);
      expect(view.handle('s').getAttribute('data-armed')).toBe('true');
      expect(view.handle('s').style.pointerEvents).toBe('auto');
    });

    it('resets size on a handle double-click, and resizes on a deliberate drag, once the handles are armed', () => {
      const view = mountSelectable(null);
      fireEvent.pointerDown(view.text(), { button: 0 });
      fireEvent.pointerUp(view.text(), { button: 0 });
      fireEvent.click(view.text());

      // Too early: a handle double-click and a handle press are both ignored.
      fireEvent.doubleClick(view.handle('e'));
      expect(view.onResetSize).not.toHaveBeenCalled();
      fireEvent.pointerDown(view.handle('e'), { button: 0, clientX: 100, clientY: 100 });
      window.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientX: 140, clientY: 100 }));
      window.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientX: 140, clientY: 100 }));
      expect(view.onResize).not.toHaveBeenCalled();

      view.advance(HANDLE_ARM_DELAY_MS);
      expect(view.handle('e').getAttribute('data-armed')).toBe('true');

      fireEvent.doubleClick(view.handle('e'));
      expect(view.onResetSize).toHaveBeenLastCalledWith('text-1', { width: true, height: false });

      // A slow, deliberate press on an armed handle still resizes (one commit).
      fireEvent.pointerDown(view.handle('e'), { button: 0, clientX: 100, clientY: 100 });
      view.advance(2000);
      window.dispatchEvent(new (globalThis as any).PointerEvent('pointermove', { clientX: 140, clientY: 100 }));
      window.dispatchEvent(new (globalThis as any).PointerEvent('pointerup', { clientX: 140, clientY: 100 }));
      expect(view.onResize.mock.calls.map((args) => args[2])).toEqual([false, true]);
      expect(view.onResize).toHaveBeenLastCalledWith('text-1', { width: 40, height: undefined }, true);
    });

    it('goes dormant again when the selection moves to another block', () => {
      const view = mountSelectable('text-1');
      view.advance(HANDLE_ARM_DELAY_MS);
      expect(view.handle('s').getAttribute('data-armed')).toBe('true');
      // Selecting the section (a different block) re-keys the adorner.
      const section = document.querySelector('[data-automation-id="designer-canvas-node-section-1"]') as HTMLElement;
      fireEvent.pointerDown(section, { button: 0 });
      expect(view.lastSelection()).toBe('section-1');
      expect(view.handle('s').getAttribute('data-armed')).toBe('false');
      view.advance(HANDLE_ARM_DELAY_MS);
      expect(view.handle('s').getAttribute('data-armed')).toBe('true');
    });

    it('clears the arming timer on unmount', () => {
      const view = mountSelectable(null);
      fireEvent.pointerDown(view.text(), { button: 0 });
      cleanup();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
