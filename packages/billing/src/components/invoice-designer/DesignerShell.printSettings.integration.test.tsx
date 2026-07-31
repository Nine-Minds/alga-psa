// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { millimetersToPixels } from '@alga-psa/types';
import { useInvoiceDesignerStore } from './state/designerStore';

vi.mock('./palette/ComponentPalette', () => ({
  ComponentPalette: () => <div data-automation-id="component-palette-mock" />,
}));

vi.mock('./toolbar/DesignerToolbar', () => ({
  DesignerToolbar: () => <div data-automation-id="designer-toolbar-mock" />,
}));

vi.mock('./inspector/DesignerSchemaInspector', () => ({
  DesignerSchemaInspector: () => <div data-automation-id="designer-schema-inspector-mock" />,
}));

vi.mock('./canvas/DesignCanvas', () => ({
  DesignCanvas: ({ nodes, selectedNodeId }: any) => {
    const pageNode = nodes.find((node: any) => node.type === 'page');
    const rulerMaxX = (Math.ceil((pageNode?.size.width ?? 0) / 50) + 1) * 50;
    const rulerMaxY = (Math.ceil((pageNode?.size.height ?? 0) / 50) + 1) * 50;

    return (
      <div
        data-automation-id="design-canvas-mock"
        data-page-width={pageNode?.size.width ?? 0}
        data-page-height={pageNode?.size.height ?? 0}
        data-ruler-max-x={rulerMaxX}
        data-ruler-max-y={rulerMaxY}
        data-selected-node-id={selectedNodeId ?? 'none'}
      />
    );
  },
}));

import { DesignerShell } from './DesignerShell';

afterEach(() => {
  cleanup();
});

describe('DesignerShell print settings controls', () => {
  beforeEach(() => {
    // Radix Select scrolls the highlighted item into view on open; jsdom has
    // no scrollIntoView, and the resulting throw unmounts the whole tree.
    // writable matters: jsdom is reused across files in the shared fork, and
    // a non-writable descriptor here makes every later file's plain
    // `Element.prototype.scrollIntoView = ...` assignment throw.
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('renders named preset options in the reachable page-setup control when nothing is selected', async () => {
    render(<DesignerShell />);

    expect(document.querySelector('[data-automation-id="designer-page-setup-panel"]')).toBeTruthy();
    // The preset control is a Radix CustomSelect: options render in a portal
    // only once the trigger is opened.
    fireEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: 'Letter' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'A4' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Legal' })).toBeTruthy();
  });

  it('reshapes the visible design canvas to A4 without requiring page-node selection', async () => {
    render(<DesignerShell />);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'A4' }));

    await waitFor(() => {
      const canvas = document.querySelector('[data-automation-id="design-canvas-mock"]');
      expect(canvas?.getAttribute('data-page-width')).toBe('794');
      expect(canvas?.getAttribute('data-page-height')).toBe('1123');
      expect(canvas?.getAttribute('data-selected-node-id')).toBe('none');
    });
  });

  it('reshapes the visible design canvas and ruler extents for Legal paper', async () => {
    render(<DesignerShell />);

    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'Legal' }));

    await waitFor(() => {
      const canvas = document.querySelector('[data-automation-id="design-canvas-mock"]');
      expect(canvas?.getAttribute('data-page-width')).toBe('816');
      expect(canvas?.getAttribute('data-page-height')).toBe('1344');
      expect(canvas?.getAttribute('data-ruler-max-y')).toBe('1400');
    });
  });

  it('accepts valid millimeter margin input and updates the printable inset live', async () => {
    render(<DesignerShell />);

    const marginInput = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(marginInput, { target: { value: '18' } });
    fireEvent.blur(marginInput);

    await waitFor(() => {
      const state = useInvoiceDesignerStore.getState();
      const documentNode = state.nodes.find((node) => node.type === 'document');
      const pageNode = state.nodes.find((node) => node.type === 'page');
      expect((documentNode?.props.metadata as any)?.printSettings?.marginMm).toBe(18);
      expect((pageNode?.props.layout as any)?.padding).toBe(`${Math.round(millimetersToPixels(18))}px`);
    });
  });

  it('clamps invalid margin values instead of producing broken page geometry', async () => {
    render(<DesignerShell />);

    const marginInput = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(marginInput, { target: { value: '99' } });
    fireEvent.blur(marginInput);

    await waitFor(() => {
      const state = useInvoiceDesignerStore.getState();
      const documentNode = state.nodes.find((node) => node.type === 'document');
      const pageNode = state.nodes.find((node) => node.type === 'page');
      expect((documentNode?.props.metadata as any)?.printSettings?.marginMm).toBe(50);
      expect((pageNode?.props.layout as any)?.padding).toBe(`${Math.round(millimetersToPixels(50))}px`);
    });

    expect(marginInput.value).toBe('50');
  });

  it('treats a blank margin field as a transient draft and restores the current margin on blur', async () => {
    render(<DesignerShell />);

    const marginInput = screen.getByRole('spinbutton') as HTMLInputElement;
    const initialHistoryIndex = useInvoiceDesignerStore.getState().historyIndex;
    fireEvent.change(marginInput, { target: { value: '' } });

    expect(marginInput.value).toBe('');
    expect(useInvoiceDesignerStore.getState().historyIndex).toBe(initialHistoryIndex);

    fireEvent.blur(marginInput);

    await waitFor(() => {
      expect(marginInput.value).toBe('10.58');
      const documentNode = useInvoiceDesignerStore.getState().nodes.find((node) => node.type === 'document');
      expect((documentNode?.props.metadata as any)?.printSettings?.marginMm).toBe(10.58);
      expect(useInvoiceDesignerStore.getState().historyIndex).toBe(initialHistoryIndex);
    });
  });
});
