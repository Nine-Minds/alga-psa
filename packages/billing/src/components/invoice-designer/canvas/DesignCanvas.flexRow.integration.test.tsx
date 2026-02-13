// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas (flex row integration)', () => {
  it('renders a flex row container with flow children and gap', () => {
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
        layout: { display: 'flex', flexDirection: 'row', gap: '10px', padding: '6px' },
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

    expect(flexWrapper.style.flexDirection).toBe('row');
    expect(flexWrapper.style.gap).toBe('10px');
    expect(flexWrapper.style.padding).toBe('6px');

    const text1 = document.querySelector('[data-automation-id="designer-canvas-node-text-1"]') as HTMLElement | null;
    const text2 = document.querySelector('[data-automation-id="designer-canvas-node-text-2"]') as HTMLElement | null;
    expect(text1).toBeTruthy();
    expect(text2).toBeTruthy();
    if (!text1 || !text2) return;

    // Flow children should not be absolutely positioned.
    expect(text2.style.position).toBe('');
    expect(text2.style.top).toBe('');
    expect(text2.style.left).toBe('');

    const flowChildIds = Array.from(flexWrapper.querySelectorAll('[data-automation-id^="designer-canvas-node-"]')).map(
      (el) => (el as HTMLElement).dataset.automationId
    );
    expect(flowChildIds).toEqual([
      'designer-canvas-node-text-1',
      'designer-canvas-node-text-2',
    ]);
  });
});

