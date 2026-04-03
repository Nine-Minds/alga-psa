// @vitest-environment jsdom

import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComponentPalette } from './ComponentPalette';
import { useInvoiceDesignerStore } from '../state/designerStore';
import { buildQuoteTemplateBindings } from '../../../lib/quote-template-ast/bindings';

afterEach(() => {
  cleanup();
});

describe('ComponentPalette quote fields tab', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
    act(() => {
      useInvoiceDesignerStore.setState(
        {
          nodes: [
            {
              id: 'doc-1',
              type: 'document',
              props: {
                name: 'Document',
                metadata: {
                  __astBindingCatalog: buildQuoteTemplateBindings(),
                },
              },
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
        } as any,
        false
      );
    });
  });

  it('shows quote total bindings for discovery and inserts their quote path aliases', () => {
    const onInsertTemplateVariable = vi.fn();

    render(
      <DndContext>
        <ComponentPalette onInsertTemplateVariable={onInsertTemplateVariable} />
      </DndContext>
    );

    fireEvent.click(screen.getByRole('button', { name: 'FIELDS' }));

    expect(screen.getByText('Quote Totals')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quote Totals Recurring Total/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quote Totals Onetime Total/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quote Totals Service Total/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quote Totals Product Total/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Quote Totals Recurring Total/i }));

    expect(onInsertTemplateVariable).toHaveBeenCalledWith('quoteTotals.recurringTotal');
  });
});
