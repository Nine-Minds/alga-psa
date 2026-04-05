// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, render, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DesignCanvas } from './DesignCanvas';
import type { DesignerNode } from '../state/designerStore';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { importTemplateAstToWorkspace } from '../ast/workspaceAst';
import { getStandardTemplateAstByCode } from '../../../lib/invoice-template-ast/standardTemplates';

afterEach(() => {
  cleanup();
  useInvoiceDesignerStore.getState().resetWorkspace();
});

const noop = () => {};

describe('DesignCanvas (media aspect-ratio integration)', () => {
  it('applies CSS aspect-ratio on media nodes and object-fit on the img', () => {
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
        props: { name: 'Section', layout: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px' } },
        position: { x: 24, y: 24 },
        size: { width: 400, height: 240 },
        parentId: 'page-1',
        children: ['image-1'],
        allowedChildren: ['image'],
      },
      {
        id: 'image-1',
        type: 'image',
        props: {
          name: 'Image',
          metadata: { src: 'https://example.com/test.png', alt: 'Test' },
          style: { aspectRatio: '16 / 9', objectFit: 'cover' },
        },
        position: { x: 0, y: 0 },
        size: { width: 320, height: 180 },
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

    const imageEl = document.querySelector('[data-automation-id="designer-canvas-node-image-1"]') as HTMLElement | null;
    expect(imageEl).toBeTruthy();
    if (!imageEl) return;

    expect(imageEl.style.aspectRatio).toBe('16 / 9');
    expect(imageEl.style.overflow).toBe('hidden');
    expect(screen.getByText('Image · image')).toBeTruthy();

    const img = imageEl.querySelector('img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    if (!img) return;
    expect(img.style.objectFit).toBe('cover');
  });

  it('keeps imported standard logos close to preview sizing constraints in the designer canvas', () => {
    const ast = getStandardTemplateAstByCode('standard-detailed');
    expect(ast).toBeTruthy();
    if (!ast) return;

    const workspace = importTemplateAstToWorkspace(ast);
    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(workspace);
    });

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
          onResize={noop}
          readOnly={false}
        />
      </DndContext>
    );

    const logoEl = document.querySelector('[data-automation-id="designer-canvas-node-issuer-logo"]') as HTMLElement | null;
    expect(logoEl).toBeTruthy();
    if (!logoEl) return;

    expect(logoEl.style.width).toBe('180px');
    expect(logoEl.style.height).toBe('72px');
  });
});
