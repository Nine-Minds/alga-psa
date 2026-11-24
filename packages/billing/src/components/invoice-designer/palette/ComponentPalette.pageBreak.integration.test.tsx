// @vitest-environment jsdom

/**
 * Users think in pages, so the page break is a palette block rather than a
 * style buried in the inspector. It must be offered for page-sized documents
 * and withheld from work tags, whose fixed-size labels are composed onto
 * sheets by the label batch pipeline.
 */
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComponentPalette } from './ComponentPalette';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { buildLabelTemplateBindings } from '../../../lib/label-template-ast/bindings';
import { buildQuoteTemplateBindings } from '../../../lib/quote-template-ast/bindings';

vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

afterEach(() => {
  cleanup();
});

const seedWorkspace = (bindingCatalog: unknown) => {
  act(() => {
    useInvoiceDesignerStore.setState(
      {
        nodes: [
          {
            id: 'doc-1',
            type: 'document',
            props: { name: 'Document', metadata: { __astBindingCatalog: bindingCatalog } },
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
            children: [],
            allowedChildren: ['section'],
          },
        ],
      } as never,
      false
    );
  });
};

describe('ComponentPalette page break block', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('offers the page break on a quote and inserts it by type', () => {
    seedWorkspace(buildQuoteTemplateBindings());
    const onInsertComponent = vi.fn();

    render(
      <DndContext>
        <ComponentPalette onInsertComponent={onInsertComponent} />
      </DndContext>
    );

    expect(screen.getByText('Page Break')).toBeTruthy();

    const addButton = document.getElementById('designer-palette-add-page-break') as HTMLButtonElement;
    expect(addButton).toBeTruthy();
    fireEvent.click(addButton);

    expect(onInsertComponent).toHaveBeenCalledWith('page-break', { after: false });
  });

  it('withholds the page break from a work-tag workspace while keeping the other blocks', () => {
    seedWorkspace(buildLabelTemplateBindings());

    render(
      <DndContext>
        <ComponentPalette onInsertComponent={vi.fn()} />
      </DndContext>
    );

    expect(screen.queryByText('Page Break')).toBeNull();
    expect(document.getElementById('designer-palette-add-page-break')).toBeNull();
    // Only the page break is withheld; the rest of the Structure group stays.
    expect(document.getElementById('designer-palette-add-spacer')).toBeTruthy();
    expect(document.getElementById('designer-palette-add-divider')).toBeTruthy();
  });
});
