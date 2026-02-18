// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas (alignment integration)', () => {
  it('applies justify-content and align-items for flex containers', () => {
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
        props: {
          name: 'Section',
          layout: {
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '4px',
            padding: '6px',
          },
        },
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        children: ['text-1', 'text-2'],
        allowedChildren: ['text'],
      },
      {
        id: 'text-1',
        type: 'text',
        props: { name: 'Text 1' },
        position: { x: 0, y: 0 },
        size: { width: 100, height: 32 },
        parentId: 'section-1',
        children: [],
        allowedChildren: [],
      },
      {
        id: 'text-2',
        type: 'text',
        props: { name: 'Text 2' },
        position: { x: 140, y: 0 },
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

    const sectionEl = document.querySelector('[data-automation-id="designer-canvas-node-section-1"]') as HTMLElement | null;
    expect(sectionEl).toBeTruthy();
    if (!sectionEl) return;

    const flexWrapper = Array.from(sectionEl.querySelectorAll('div')).find(
      (el) => (el as HTMLElement).style.display === 'flex'
    ) as HTMLElement | undefined;
    expect(flexWrapper).toBeTruthy();
    if (!flexWrapper) return;

    expect(flexWrapper.style.justifyContent).toBe('space-between');
    expect(flexWrapper.style.alignItems).toBe('center');
  });
});
