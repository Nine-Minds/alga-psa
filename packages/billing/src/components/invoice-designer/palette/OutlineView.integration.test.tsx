// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useInvoiceDesignerStore } from '../state/designerStore';
import { OutlineView } from './OutlineView';

afterEach(() => {
  cleanup();
});

describe('OutlineView', () => {
  beforeEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders nodes in children order and highlights the selected node', async () => {
    let sectionBId: string | null = null;
    act(() => {
      const store = useInvoiceDesignerStore.getState();
      const pageId = store.nodes.find((node) => node.type === 'page')?.id;
      expect(pageId).toBeTruthy();
      if (!pageId) return;

      store.addNodeFromPalette('section', { x: 40, y: 40 }, { parentId: pageId });
      const sectionAId = useInvoiceDesignerStore.getState().selectedNodeId;
      expect(sectionAId).toBeTruthy();
      if (!sectionAId) return;
      store.setNodeProp(sectionAId, 'name', 'Section A');

      store.addNodeFromPalette('section', { x: 60, y: 60 }, { parentId: pageId });
      sectionBId = useInvoiceDesignerStore.getState().selectedNodeId;
      expect(sectionBId).toBeTruthy();
      if (!sectionBId) return;
      store.setNodeProp(sectionBId, 'name', 'Section B');
      store.selectNode(sectionBId);
    });

    render(<OutlineView />);

    // Auto-expand should open ancestors of the selection.
    await waitFor(() => {
      expect(screen.getByText('Section A')).toBeTruthy();
      expect(screen.getByText('Section B')).toBeTruthy();
    });

    const sectionA = screen.getByText('Section A');
    const sectionB = screen.getByText('Section B');
    expect(sectionA.compareDocumentPosition(sectionB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Selected node is highlighted.
    const sectionARow = screen.getByText('Section A').closest('div') as HTMLElement;
    const sectionBRow = screen.getByText('Section B').closest('div') as HTMLElement;
    expect(sectionBRow.className).toContain('bg-blue-600');

    // Clicking a row selects it and updates highlight.
    fireEvent.click(sectionARow);
    expect(sectionARow.className).toContain('bg-blue-600');
    expect(sectionBRow.className).not.toContain('bg-blue-600');
  });
});
