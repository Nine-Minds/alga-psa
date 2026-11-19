// @vitest-environment jsdom

/**
 * The Pagination group is what an author reaches for to make a quote read as a
 * cover page, a pricing page and a signature page. Both of its controls edit a
 * CSS keyword rather than a flag, so unchecking has to remove the property
 * outright — leaving `breakBefore: false` behind would be an invalid
 * declaration the renderer passes straight to React.
 *
 * Work tags are fixed-size labels composed onto sheets by the label batch
 * pipeline, so the group must not appear for them at all.
 */
import React, { useMemo } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignerSchemaInspector } from './DesignerSchemaInspector';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';
import { buildLabelTemplateBindings } from '../../../lib/label-template-ast/bindings';
import { buildQuoteTemplateBindings } from '../../../lib/quote-template-ast/bindings';

afterEach(() => {
  cleanup();
});

const Wrapper: React.FC = () => {
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
  const node = useInvoiceDesignerStore((state) =>
    selectedNodeId ? (state.nodesById[selectedNodeId] as DesignerNode | undefined) : undefined
  );
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);
  if (!node) return null;
  return <DesignerSchemaInspector node={node} nodesById={nodesById} tab="layout" />;
};

const seedWorkspace = (bindingCatalog: unknown) => {
  act(() => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': {
          id: 'doc-1',
          type: 'document',
          props: { name: 'Document', metadata: { __astBindingCatalog: bindingCatalog } },
          children: ['page-1'],
        },
        'page-1': { id: 'page-1', type: 'page', props: { name: 'Page 1' }, children: ['section-1'] },
        'section-1': {
          id: 'section-1',
          type: 'section',
          props: {
            name: 'Pricing',
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
};

const sectionStyle = () =>
  (useInvoiceDesignerStore.getState().nodesById['section-1'].props as { style?: Record<string, unknown> }).style ?? {};

describe('DesignerSchemaInspector pagination group', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('writes the forced-break keyword on a quote section and clears it when unchecked', () => {
    seedWorkspace(buildQuoteTemplateBindings());
    render(<Wrapper />);

    expect(screen.getByText('Pagination')).toBeTruthy();

    const startNewPage = document.getElementById('designer-pagination-start-new-page') as HTMLInputElement;
    expect(startNewPage).toBeTruthy();
    expect(startNewPage.checked).toBe(false);

    fireEvent.click(startNewPage);
    expect(sectionStyle().breakBefore).toBe('page');

    fireEvent.click(document.getElementById('designer-pagination-start-new-page') as HTMLInputElement);
    // Unset, not `false`: a boolean would reach the renderer as `break-before: false`.
    expect(sectionStyle()).not.toHaveProperty('breakBefore');
  });

  it('writes the keep-together keyword and reflects an already-set value as checked', () => {
    seedWorkspace(buildQuoteTemplateBindings());
    render(<Wrapper />);

    const keepTogether = document.getElementById('designer-pagination-keep-together') as HTMLInputElement;
    expect(keepTogether.checked).toBe(false);

    fireEvent.click(keepTogether);
    expect(sectionStyle().breakInside).toBe('avoid');
    expect((document.getElementById('designer-pagination-keep-together') as HTMLInputElement).checked).toBe(true);
  });

  it('hides the group for a work-tag workspace, whose labels have no pages to break', () => {
    seedWorkspace(buildLabelTemplateBindings());
    render(<Wrapper />);

    expect(screen.queryByText('Pagination')).toBeNull();
    expect(document.getElementById('designer-pagination-start-new-page')).toBeNull();
    expect(document.getElementById('designer-pagination-keep-together')).toBeNull();
  });
});
