// @vitest-environment jsdom

import React, { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignerSchemaInspector } from './DesignerSchemaInspector';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';

afterEach(() => {
  cleanup();
});

describe('DesignerSchemaInspector (schema-driven integration)', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders controls from schema and updates node props via generic patch operations', () => {
    act(() => {
      const store = useInvoiceDesignerStore.getState();
      store.loadWorkspace({
        rootId: 'doc-1',
        nodesById: {
          'doc-1': { id: 'doc-1', type: 'document', props: { name: 'Document' }, children: ['page-1'] },
          'page-1': { id: 'page-1', type: 'page', props: { name: 'Page 1' }, children: ['section-1'] },
          'section-1': {
            id: 'section-1',
            type: 'section',
            props: {
              name: 'Section',
              layout: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' },
              style: { width: '400px', height: '240px' },
              metadata: {},
            },
            children: [],
          },
        },
        snapToGrid: false,
        gridSize: 8,
        showGuides: false,
        showRulers: false,
        canvasScale: 1,
      });
      store.selectNode('section-1');
    });

    const Wrapper: React.FC = () => {
      const nodes = useInvoiceDesignerStore((state) => state.nodes);
      const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
      const node = useInvoiceDesignerStore((state) =>
        selectedNodeId ? (state.nodesById[selectedNodeId] as DesignerNode | undefined) : undefined
      );
      const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
      if (!node) return null;
      return <DesignerSchemaInspector node={node} nodesById={nodesById} />;
    };

    render(<Wrapper />);

    // Schema-driven panels are present.
    expect(screen.getByText('Sizing (CSS)')).toBeTruthy();

    // Updating a field writes through the store patch API and updates unified props.
    // Note: the shared <Input> component does not currently forward `id` to the native input,
    // so label->control association isn't reliable in tests. Use the field placeholder instead.
    const widthInput = screen.getByPlaceholderText('auto | 320px | 50% | 10rem') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '123' } });

    const updated = useInvoiceDesignerStore.getState().nodesById['section-1'];
    const width = (updated.props as any)?.style?.width;
    expect(width).toBe('123px');
  });
});
