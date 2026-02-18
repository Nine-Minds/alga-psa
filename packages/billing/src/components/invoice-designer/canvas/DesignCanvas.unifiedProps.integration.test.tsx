// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => cleanup());

const noop = () => {};

describe('DesignCanvas (unified props integration)', () => {
  it('reads layout/style from node.props.* (without relying on legacy node.layout/node.style)', () => {
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
          layout: {
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '6px',
            justifyContent: 'flex-start',
            alignItems: 'stretch',
          },
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
          metadata: { text: 'Hello' },
          style: {
            width: '320px',
            height: 'auto',
            minWidth: '12rem',
            minHeight: '40px',
            maxWidth: '100%',
            maxHeight: '480px',
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

    expect(textEl.style.width).toBe('320px');
    expect(textEl.style.height).toBe('auto');
    expect(textEl.style.minWidth).toBe('12rem');
    expect(textEl.style.minHeight).toBe('40px');
    expect(textEl.style.maxWidth).toBe('100%');
    expect(textEl.style.maxHeight).toBe('480px');

    const sectionEl = document.querySelector('[data-automation-id="designer-canvas-node-section-1"]') as HTMLElement | null;
    expect(sectionEl).toBeTruthy();
    if (!sectionEl) return;

    const flexSurface = Array.from(sectionEl.querySelectorAll('div')).find(
      (el) => (el as HTMLElement).style.display === 'flex'
    ) as HTMLElement | undefined;
    expect(flexSurface).toBeTruthy();
    if (!flexSurface) return;

    expect(flexSurface.style.flexDirection).toBe('column');
    expect(flexSurface.style.gap).toBe('6px');
    expect(flexSurface.style.padding).toBe('6px');
  });
});
