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

vi.mock('./inspector/DesignerSchemaInspector', () => ({
  DesignerSchemaInspector: () => <div data-automation-id="designer-schema-inspector-mock" />,
}));

vi.mock('./inspector/widgets/DocumentImagePickerWidget', () => ({
  default: () => <div data-automation-id="document-image-picker-mock" />,
}));

import { DesignerShell } from './DesignerShell';

const seedSelectedDynamicTableNode = () => {
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
          props: {
            name: 'Page',
            layout: { display: 'flex', flexDirection: 'column', gap: '32px', padding: '40px' },
            style: { width: '816px', height: '1056px' },
          },
          position: { x: 0, y: 0 },
          size: { width: 816, height: 1056 },
          parentId: 'doc-1',
          children: ['table-1'],
          allowedChildren: ['section', 'table', 'dynamic-table', 'totals'],
        },
        {
          id: 'table-1',
          type: 'dynamic-table',
          props: {
            name: 'Line Items',
            metadata: {
              collectionBindingKey: 'items',
              columns: [
                { id: 'description', header: 'Description', key: 'item.description', type: 'text' },
                { id: 'total', header: 'Amount', key: 'item.total', type: 'currency' },
              ],
            },
            style: {
              width: '520px',
              height: '240px',
            },
          },
          position: { x: 40, y: 80 },
          size: { width: 520, height: 240 },
          parentId: 'page-1',
          children: [],
          allowedChildren: [],
        },
      ],
      snapToGrid: true,
      gridSize: 8,
      showGuides: true,
      showRulers: true,
      canvasScale: 1,
    } as any);
    store.selectNode('table-1');
  });
};

afterEach(() => {
  cleanup();
});

describe('DesignerShell shared sizing controls', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    // Layout, size and flex controls live on the inspector's "Layout & size" tab.
    useInvoiceDesignerStore.getState().setInspectorTab('layout');
  });

  it('sets width and height through one Size control: modes plus a typed value', () => {
    seedSelectedDynamicTableNode();

    render(<DesignerShell />);

    fireEvent.click(screen.getByRole('button', { name: 'Width: Fill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Height: Auto' }));

    const stateAfterModeChange = useInvoiceDesignerStore.getState().nodesById['table-1'];
    expect((stateAfterModeChange.props as any)?.style?.width).toBe('100%');
    expect((stateAfterModeChange.props as any)?.style?.height).toBe('auto');

    // Coordinates are meaningless in flow layout, so there are no X/Y inputs to confuse sizing.
    expect(document.querySelector('[data-automation-id="designer-prop-x"]')).toBeNull();

    // Typing a value is the Fixed mode: a bare number means pixels.
    const widthValue = screen.getByLabelText('Width value') as HTMLInputElement;
    fireEvent.blur(widthValue, { target: { value: '320' } });
    const updated = useInvoiceDesignerStore.getState().nodesById['table-1'];
    expect((updated.props as any)?.style?.width).toBe('320px');
    expect((updated.props as any)?.style?.height).toBe('auto');
    expect(screen.getByRole('button', { name: 'Width: Fixed' }).getAttribute('aria-pressed')).toBe('true');
  });
});
