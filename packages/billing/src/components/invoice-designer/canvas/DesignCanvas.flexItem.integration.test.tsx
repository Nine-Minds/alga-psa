// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas (flex item integration)', () => {
  it('applies flex grow/shrink/basis from node.style on flex children', () => {
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
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        childIds: ['text-1', 'text-2'],
        allowedChildren: ['text'],
        layout: { display: 'flex', flexDirection: 'row', gap: '6px', padding: '6px' },
      },
      {
        id: 'text-1',
        type: 'text',
        name: 'Text 1',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
        style: { flexGrow: 1, flexShrink: 0, flexBasis: '240px' },
      },
      {
        id: 'text-2',
        type: 'text',
        name: 'Text 2',
        position: { x: 140, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        childIds: [],
        allowedChildren: [],
        style: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto' },
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

    const text1 = document.querySelector('[data-automation-id="designer-canvas-node-text-1"]') as HTMLElement | null;
    const text2 = document.querySelector('[data-automation-id="designer-canvas-node-text-2"]') as HTMLElement | null;
    expect(text1).toBeTruthy();
    expect(text2).toBeTruthy();
    if (!text1 || !text2) return;

    expect(text1.style.flexGrow).toBe('1');
    expect(text1.style.flexShrink).toBe('0');
    expect(text1.style.flexBasis).toBe('240px');

    expect(text2.style.flexGrow).toBe('0');
    expect(text2.style.flexShrink).toBe('1');
    expect(text2.style.flexBasis).toBe('auto');
  });
});

