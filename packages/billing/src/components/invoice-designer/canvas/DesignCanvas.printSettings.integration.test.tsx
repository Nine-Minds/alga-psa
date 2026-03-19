// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas print settings integration', () => {
  it('derives the artboard width and height from the resolved page preset instead of fixed legacy constants', () => {
    const nodes: DesignerNode[] = [
      {
        id: 'doc-1',
        type: 'document',
        props: {
          name: 'Document',
          metadata: {},
          layout: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '0px' },
          style: { width: '794px', height: '1123px' },
        },
        position: { x: 0, y: 0 },
        size: { width: 794, height: 1123 },
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
          layout: { display: 'flex', flexDirection: 'column', gap: '32px', padding: '45px' },
          style: { width: '794px', height: '1123px' },
        },
        position: { x: 0, y: 0 },
        size: { width: 794, height: 1123 },
        parentId: 'doc-1',
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
          showRulers={true}
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

    const artboard = document.querySelector('[data-designer-canvas="true"]') as HTMLElement | null;
    expect(artboard).toBeTruthy();
    expect(artboard?.style.width).toBe('794px');
    expect(artboard?.style.height).toBe('1123px');
    expect(artboard?.style.minHeight).toBe('1123px');
    expect(document.body.textContent).toContain('1150');
  });
});
