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

const seedSelectedField = (bindingKey: string) => {
  act(() => {
    useInvoiceDesignerStore.getState().loadWorkspace({
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
          children: ['field-1'],
          allowedChildren: ['field'],
        },
        {
          id: 'field-1',
          type: 'field',
          props: {
            name: 'Bound Field',
            metadata: {
              bindingKey,
              format: 'text',
            },
          },
          position: { x: 24, y: 24 },
          size: { width: 220, height: 60 },
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
    useInvoiceDesignerStore.getState().selectNode('field-1');
  });
};

afterEach(() => {
  cleanup();
});

describe('DesignerShell field display controls', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('shows address display formats and persists the selected mode', () => {
    seedSelectedField('tenant.address');

    render(<DesignerShell />);

    expect(screen.getByText('Display Format')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Display format: Multiline' }));

    const updated = useInvoiceDesignerStore.getState().nodesById['field-1'];
    expect((updated.props as any)?.metadata?.displayFormat).toBe('multiline');
  });

  it('shows address display controls for address aliases like client.address', () => {
    seedSelectedField('client.address');

    render(<DesignerShell />);

    expect(screen.getByText('Display Format')).toBeTruthy();
  });

  it('shows address display controls for imported tenantClient.address bindings', () => {
    seedSelectedField('tenantClient.address');

    render(<DesignerShell />);

    expect(screen.getByText('Display Format')).toBeTruthy();
  });

  it('shows address display controls for contact.address', () => {
    seedSelectedField('contact.address');

    render(<DesignerShell />);

    expect(screen.getByText('Display Format')).toBeTruthy();
  });

  it('does not show address display controls for non-address bindings', () => {
    seedSelectedField('invoice.number');

    render(<DesignerShell />);

    expect(screen.queryByText('Display Format')).toBeNull();
  });
});
