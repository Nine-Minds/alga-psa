// @vitest-environment jsdom

/**
 * A forced break is invisible in the document, so without a canvas marker the
 * designer reads as one unbroken flow and the author cannot tell where page two
 * begins. Both markers are canvas chrome: the renderer emits nothing for them.
 */
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

const buildNodes = (): DesignerNode[] => [
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
    children: ['break-1', 'section-1', 'section-2'],
    allowedChildren: ['section', 'page-break'],
  },
  {
    id: 'break-1',
    type: 'page-break',
    props: { name: 'Page Break', style: { breakAfter: 'page' } },
    position: { x: 0, y: 0 },
    size: { width: 320, height: 24 },
    parentId: 'page-1',
    children: [],
    allowedChildren: [],
  },
  {
    id: 'section-1',
    type: 'section',
    props: { name: 'Signature', style: { breakBefore: 'page' }, metadata: {} },
    position: { x: 0, y: 40 },
    size: { width: 400, height: 120 },
    parentId: 'page-1',
    children: [],
    allowedChildren: ['text'],
  },
  {
    id: 'section-2',
    type: 'section',
    props: { name: 'Notes', metadata: {} },
    position: { x: 0, y: 200 },
    size: { width: 400, height: 120 },
    parentId: 'page-1',
    children: [],
    allowedChildren: ['text'],
  },
];

const renderCanvas = () =>
  render(
    <DndContext>
      <DesignCanvas
        nodes={buildNodes()}
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

describe('DesignCanvas page break indication', () => {
  it('draws a labelled band for a page-break block', () => {
    renderCanvas();

    const breakEl = document.querySelector('[data-automation-id="designer-canvas-node-break-1"]') as HTMLElement | null;
    expect(breakEl).toBeTruthy();

    const band = breakEl?.querySelector('[data-automation-id="designer-canvas-page-break"]') as HTMLElement | null;
    expect(band).toBeTruthy();
    expect(band?.textContent).toContain('Page break');
  });

  it('marks a block that starts a new page, and leaves the rest unmarked', () => {
    renderCanvas();

    const startsPage = document.querySelector('[data-automation-id="designer-canvas-node-section-1"]') as HTMLElement | null;
    expect(startsPage?.querySelector('[data-automation-id="designer-canvas-page-break-before"]')).toBeTruthy();

    const flows = document.querySelector('[data-automation-id="designer-canvas-node-section-2"]') as HTMLElement | null;
    expect(flows?.querySelector('[data-automation-id="designer-canvas-page-break-before"]')).toBeNull();
  });
});
