// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInvoiceDesignerStore } from './state/designerStore';

// Keep this test focused on the selected-node header; stub out heavy child components.
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

import { DesignerShell } from './DesignerShell';

afterEach(() => {
  cleanup();
});

describe('DesignerShell selected context header', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders the selected node name via canonical props helpers', () => {
    act(() => {
      useInvoiceDesignerStore.setState(
        {
          selectedNodeId: 'text-1',
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
              children: ['text-1'],
              allowedChildren: ['text'],
            },
            {
              id: 'text-1',
              type: 'text',
              props: { name: 'Canonical Name' },
              position: { x: 20, y: 20 },
              size: { width: 120, height: 32 },
              parentId: 'page-1',
              children: [],
              allowedChildren: [],
            },
          ],
        } as any,
        false
      );
    });

    render(<DesignerShell />);

    const selected = document.querySelector('[data-automation-id="designer-selected-context"]');
    expect(selected?.textContent).toContain('Canonical Name');
    expect(selected?.textContent).toContain('(text)');
  });
});
