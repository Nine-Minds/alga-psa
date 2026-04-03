// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInvoiceDesignerStore } from './state/designerStore';

vi.mock('./palette/ComponentPalette', () => ({
  ComponentPalette: () => <div data-automation-id="component-palette-mock" />,
}));

vi.mock('./canvas/DesignCanvas', () => ({
  DesignCanvas: () => <div data-automation-id="design-canvas-mock" />,
}));

vi.mock('./toolbar/DesignerToolbar', () => ({
  DesignerToolbar: () => <div data-automation-id="designer-toolbar-mock" />,
}));

import { DesignerShell } from './DesignerShell';

const seedSelectedLayoutNode = (
  layout: Record<string, unknown>,
  nodeType: 'container' | 'section' = 'container'
) => {
  const nodeId = nodeType === 'section' ? 'section-1' : 'container-1';
  const pageChildren = [nodeId];

  act(() => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      nodes: [
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
          props: { name: 'Page' },
          position: { x: 0, y: 0 },
          size: { width: 816, height: 1056 },
          parentId: 'doc-1',
          children: pageChildren,
          allowedChildren: ['container', 'section'],
        },
        {
          id: nodeId,
          type: nodeType,
          props: {
            name: nodeType === 'section' ? 'Grid Section' : 'Grid Container',
            layout,
            style: {},
            metadata: {},
          },
          position: { x: 24, y: 24 },
          size: { width: 420, height: 180 },
          parentId: 'page-1',
          children: [],
          allowedChildren: ['label', 'field', 'text', 'container', 'table', 'dynamic-table', 'totals', 'subtotal', 'tax', 'discount', 'custom-total', 'spacer', 'divider', 'image', 'logo', 'qr', 'signature', 'attachment-list', 'action-button'],
        },
      ],
      snapToGrid: true,
      gridSize: 8,
      showGuides: true,
      showRulers: true,
      canvasScale: 1,
    } as any);
    store.selectNode(nodeId);
  });
};

afterEach(() => {
  cleanup();
});

describe('DesignerShell grid layout controls', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders 5 visual grid column presets when the selected container is in grid mode', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr 1fr' });

    render(<DesignerShell />);

    expect(screen.getByRole('button', { name: 'Columns: 1 column' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns: 2 equal columns' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns: Sidebar + main' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns: Main + sidebar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns: 3 equal columns' })).toBeTruthy();
  });

  it('keeps the grid column presets visible when the selected node starts in flex mode', () => {
    seedSelectedLayoutNode({ display: 'flex', flexDirection: 'column' });

    render(<DesignerShell />);

    expect(screen.getByRole('button', { name: 'Columns: 1 column' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns: 2 equal columns' })).toBeTruthy();
  });

  it('sets gridTemplateColumns to 1fr 1fr when 2 equal columns is clicked', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr' });

    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns: 2 equal columns' }));

    const layout = (useInvoiceDesignerStore.getState().nodesById['container-1'].props as any)?.layout;
    expect(layout.display).toBe('grid');
    expect(layout.gridTemplateColumns).toBe('1fr 1fr');
  });

  it('sets gridTemplateColumns to 1fr 2fr when Sidebar + main is clicked', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr' });

    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns: Sidebar + main' }));

    expect(((useInvoiceDesignerStore.getState().nodesById['container-1'].props as any)?.layout ?? {}).gridTemplateColumns).toBe('1fr 2fr');
  });

  it('sets gridTemplateColumns to 2fr 1fr when Main + sidebar is clicked', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr' });

    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns: Main + sidebar' }));

    expect(((useInvoiceDesignerStore.getState().nodesById['container-1'].props as any)?.layout ?? {}).gridTemplateColumns).toBe('2fr 1fr');
  });

  it('sets gridTemplateColumns to 1fr 1fr 1fr when 3 equal columns is clicked', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr' });

    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns: 3 equal columns' }));

    expect(((useInvoiceDesignerStore.getState().nodesById['container-1'].props as any)?.layout ?? {}).gridTemplateColumns).toBe('1fr 1fr 1fr');
  });

  it('sets gridTemplateColumns to 1fr when 1 column is clicked', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr 1fr' });

    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns: 1 column' }));

    expect(((useInvoiceDesignerStore.getState().nodesById['container-1'].props as any)?.layout ?? {}).gridTemplateColumns).toBe('1fr');
  });

  it('highlights the active preset based on the current gridTemplateColumns value', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr 1fr' });

    render(<DesignerShell />);

    expect(screen.getByRole('button', { name: 'Columns: 2 equal columns' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Columns: 1 column' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves all presets inactive when gridTemplateColumns is a custom value', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' });

    render(<DesignerShell />);

    const pressedStates = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-label')?.startsWith('Columns: '))
      .map((button) => button.getAttribute('aria-pressed'));

    expect(pressedStates).toEqual(['false', 'false', 'false', 'false', 'false']);
  });

  it('keeps the raw Template Columns CSS input visible below the visual picker for custom values', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr 2fr' });

    render(<DesignerShell />);

    const presets = document.querySelector('[data-automation-id="designer-container-layout-grid-presets"]');
    const rawInput = screen.getByPlaceholderText('repeat(2, minmax(0, 1fr))');

    expect(presets).toBeTruthy();
    expect(rawInput).toBeTruthy();
    expect(Boolean(presets!.compareDocumentPosition(rawInput) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('retains dark-theme styling hooks for the grid preset controls', () => {
    seedSelectedLayoutNode({ display: 'grid', gridTemplateColumns: '1fr 2fr' });

    render(
      <div className="dark">
        <DesignerShell />
      </div>
    );

    const layoutPanel = screen.getByText('Layout Controls').closest('div');
    const activePreset = screen.getByRole('button', { name: 'Columns: Sidebar + main' });
    const inactivePreset = screen.getByRole('button', { name: 'Columns: 1 column' });

    expect(layoutPanel?.className).toContain('dark:bg-[rgb(var(--color-card))]');
    expect(activePreset.className).toContain('dark:bg-blue-900/40');
    expect(activePreset.className).toContain('dark:text-blue-300');
    expect(inactivePreset.className).toContain('dark:border-[rgb(var(--color-border-200))]');
    expect(inactivePreset.className).toContain('dark:hover:bg-slate-800');
  });

  it('switches a flex layout into grid mode when a grid preset is chosen', () => {
    seedSelectedLayoutNode({ display: 'flex', flexDirection: 'column' });

    render(<DesignerShell />);
    fireEvent.click(screen.getByRole('button', { name: 'Columns: 2 equal columns' }));

    const layout = (useInvoiceDesignerStore.getState().nodesById['container-1'].props as any)?.layout;
    expect(layout.display).toBe('grid');
    expect(layout.gridTemplateColumns).toBe('1fr 1fr');
  });

  it('renders the layout controls and grid presets for selected section nodes', () => {
    seedSelectedLayoutNode({ display: 'flex', flexDirection: 'column' }, 'section');

    render(<DesignerShell />);

    expect(document.querySelector('[data-automation-id="designer-container-layout-controls"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns: 1 column' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Layout: Grid' })).toBeTruthy();
  });
});
