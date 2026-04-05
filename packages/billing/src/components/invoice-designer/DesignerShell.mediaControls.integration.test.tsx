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

const seedSelectedMediaNode = () => {
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
          children: ['logo-1'],
          allowedChildren: ['image', 'logo', 'qr'],
        },
        {
          id: 'logo-1',
          type: 'logo',
          props: {
            name: 'Issuer Logo',
            style: {
              objectFit: 'contain',
            },
            metadata: {
              src: '/logo.png',
              fitMode: 'contain',
              fit: 'contain',
            },
          },
          position: { x: 24, y: 24 },
          size: { width: 180, height: 72 },
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
    store.selectNode('logo-1');
  });
};

afterEach(() => {
  cleanup();
});

describe('DesignerShell media controls', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('updates object fit through the icon button control', () => {
    seedSelectedMediaNode();

    render(<DesignerShell />);

    const containButton = screen.getByRole('button', { name: 'Object Fit: Contain' });
    const coverButton = screen.getByRole('button', { name: 'Object Fit: Cover' });

    expect(containButton.getAttribute('aria-pressed')).toBe('true');
    expect(coverButton.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(coverButton);

    const mediaNode = useInvoiceDesignerStore.getState().nodesById['logo-1'];
    expect((mediaNode.props as any)?.style?.objectFit).toBe('cover');
    expect((mediaNode.props as any)?.metadata?.fitMode).toBe('cover');
    expect((mediaNode.props as any)?.metadata?.fit).toBe('cover');
    expect(screen.getByRole('button', { name: 'Object Fit: Cover' }).getAttribute('aria-pressed')).toBe('true');
  });
});
