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

const seedSelectedFlexChild = () => {
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
          children: ['section-1'],
          allowedChildren: ['section'],
        },
        {
          id: 'section-1',
          type: 'section',
          props: {
            name: 'Header Row',
            layout: {
              display: 'flex',
              flexDirection: 'row',
              gap: '16px',
              padding: '16px',
              justifyContent: 'flex-start',
              alignItems: 'stretch',
            },
            metadata: {},
            style: { width: '520px', height: '160px' },
          },
          position: { x: 24, y: 24 },
          size: { width: 520, height: 160 },
          parentId: 'page-1',
          children: ['field-1'],
          allowedChildren: ['field'],
        },
        {
          id: 'field-1',
          type: 'field',
          props: {
            name: 'Invoice Number',
            metadata: { bindingKey: 'invoice.number' },
            style: { width: '180px', height: '48px' },
          },
          position: { x: 0, y: 0 },
          size: { width: 180, height: 48 },
          parentId: 'section-1',
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
    store.selectNode('field-1');
  });
};

afterEach(() => {
  cleanup();
});

describe('DesignerShell flex item controls', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('applies share preset and advanced preferred size edits for flex children', () => {
    seedSelectedFlexChild();

    render(<DesignerShell />);

    expect(screen.getByText('Flex Item')).toBeTruthy();
    expect(screen.getByText(/shares width with its siblings/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Width behavior: Share' }));

    let updated = useInvoiceDesignerStore.getState().nodesById['field-1'];
    expect((updated.props as any)?.style?.flexGrow).toBe(1);
    expect((updated.props as any)?.style?.flexShrink).toBe(1);
    expect((updated.props as any)?.style?.flexBasis).toBe('0%');

    fireEvent.click(screen.getByText('Advanced Flex Values'));
    const preferredSizeInput = screen.getByPlaceholderText('auto | 240px | 50%') as HTMLInputElement;
    fireEvent.change(preferredSizeInput, { target: { value: '320px' } });
    fireEvent.blur(preferredSizeInput);

    updated = useInvoiceDesignerStore.getState().nodesById['field-1'];
    expect((updated.props as any)?.style?.flexBasis).toBe('320px');
  });
});
