// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas (sizing strings integration)', () => {
  it('reflects non-px CSS sizing strings from node.props.style on the canvas', () => {
    const nodes: DesignerNode[] = [
      {
        id: 'doc-1',
        type: 'document',
        props: {
          name: 'Document',
          metadata: {},
          layout: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '0px' },
          style: { width: '816px', height: '1056px' },
        },
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: null,
        children: ['page-1'],
        allowedChildren: ['page'],
      },
      {
        id: 'page-1',
        type: 'page',
        props: {
          name: 'Page 1',
          metadata: {},
          layout: { display: 'flex', flexDirection: 'column', gap: '32px', padding: '40px' },
          style: { width: '816px', height: '1056px' },
        },
        position: { x: 0, y: 0 },
        size: { width: 816, height: 1056 },
        parentId: 'doc-1',
        children: ['section-1'],
        allowedChildren: ['section'],
      },
      {
        id: 'section-1',
        type: 'section',
        props: {
          name: 'Section',
          metadata: {},
          layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' },
          style: { width: '400px', height: '240px' },
        },
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        children: ['text-1'],
        allowedChildren: ['text'],
      },
      {
        id: 'text-1',
        type: 'text',
        props: {
          name: 'Text 1',
          metadata: {},
          style: {
            width: '50%',
            height: 'auto',
            minWidth: '12rem',
          },
        },
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        children: [],
        allowedChildren: [],
      },
    ];

    render(
      <DndContext>
        <DesignCanvas
          nodes={nodes}
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

    const textEl = document.querySelector('[data-automation-id="designer-canvas-node-text-1"]') as HTMLElement | null;
    expect(textEl).toBeTruthy();
    if (!textEl) return;

    expect(textEl.style.width).toBe('50%');
    expect(textEl.style.height).toBe('auto');
    expect(textEl.style.minWidth).toBe('12rem');
  });
});
