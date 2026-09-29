// @vitest-environment jsdom

import React, { useMemo } from 'react';
import { DndContext } from '@dnd-kit/core';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignerSchemaInspector } from './DesignerSchemaInspector';
import { DesignCanvas } from '../canvas/DesignCanvas';
import { useInvoiceDesignerStore } from '../state/designerStore';
import type { DesignerNode } from '../state/designerStore';

const noop = () => {};

type RowFixture = {
  id: string;
  label?: string;
  __astLabelI18n?: { i18nKey: string; defaultValue: string };
  valuePath?: string;
  valueExpression?: { type: 'binding'; bindingId: string } | { type: 'path'; path: string };
  format?: string;
  emphasize?: boolean;
  style?: { inline: Record<string, string> };
  labelStyle?: { inline: Record<string, string> };
};

const groupedPurpleStyle = {
  inline: { backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px', borderRadius: '4px', margin: '2px 0' },
};

const mountTotalsInspectorAndCanvas = ({ rows }: { rows: RowFixture[] }) => {
  act(() => {
    const store = useInvoiceDesignerStore.getState();
    store.loadWorkspace({
      rootId: 'doc-1',
      nodesById: {
        'doc-1': {
          id: 'doc-1',
          type: 'document',
          props: {
            name: 'Document',
            metadata: {},
            layout: { display: 'flex', flexDirection: 'column' },
            style: { width: '816px', height: '1056px' },
          },
          children: ['page-1'],
        },
        'page-1': {
          id: 'page-1',
          type: 'page',
          props: { name: 'Page 1', layout: { display: 'flex', flexDirection: 'column' }, style: { width: '816px', height: '1056px' } },
          children: ['totals-1'],
        },
        'totals-1': {
          id: 'totals-1',
          type: 'totals',
          props: {
            name: 'Totals',
            metadata: { totalsRows: rows },
            style: { width: '360px', height: '140px' },
          },
          children: [],
        },
      },
      transforms: { sourceBindingId: '', outputBindingId: '', operations: [] },
      snapToGrid: false,
      gridSize: 8,
      showGuides: false,
      showRulers: false,
      canvasScale: 1,
    });
    store.selectNode('totals-1');
  });

  const Wrapper: React.FC = () => {
    const nodes = useInvoiceDesignerStore((state) => state.nodes);
    const selectedNodeId = useInvoiceDesignerStore((state) => state.selectedNodeId);
    const node = useInvoiceDesignerStore((state) =>
      selectedNodeId ? (state.nodesById[selectedNodeId] as DesignerNode | undefined) : undefined
    );
    const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n] as const)), [nodes]);

    return (
      <div>
        {node ? <DesignerSchemaInspector node={node} nodesById={nodesById} /> : null}
        <DndContext>
          <DesignCanvas
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            showGuides={false}
            showRulers={false}
            gridSize={8}
            canvasScale={1}
            snapToGrid={false}
            guides={[]}
            isDragActive={false}
            forcedDropTarget={null}
            droppableId="canvas"
            onPointerLocationChange={noop}
            onNodeSelect={noop}
            onResize={noop}
            readOnly={true}
          />
        </DndContext>
      </div>
    );
  };

  render(<Wrapper />);
};

const totalsNode = () => useInvoiceDesignerStore.getState().nodesById['totals-1'] as DesignerNode | undefined;
const totalsRows = (): Array<Record<string, any>> => {
  const props = totalsNode()?.props as { metadata?: { totalsRows?: Array<Record<string, any>> } };
  return props?.metadata?.totalsRows ?? [];
};

const inspectorPanel = (): HTMLElement => {
  const el = document.querySelector('[data-automation-id="designer-schema-inspector"]') as HTMLElement | null;
  if (!el) throw new Error('Missing schema inspector');
  return el;
};

const inputByAutomationId = (id: string): HTMLInputElement => {
  const el = document.querySelector(`[data-automation-id="${id}"]`) as HTMLInputElement | null;
  if (!el) throw new Error(`Missing input ${id}`);
  return el;
};

const canvasRow = (rowId: string): HTMLElement | null =>
  document.querySelector(`[data-automation-id="designer-canvas-total-row-${rowId}"]`);

describe('TotalsRowsEditorWidget (schema widget integration)', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      writable: true,
      value: () => false,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      writable: true,
      value: () => undefined,
    });
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  afterEach(() => cleanup());

  const defaultRows: RowFixture[] = [
    {
      id: 'monthly-total',
      label: 'Monthly Total',
      __astLabelI18n: { i18nKey: 'labels.monthlyTotal', defaultValue: 'Monthly Total' },
      valueExpression: { type: 'binding', bindingId: 'recurringTotal' },
      format: 'currency',
      emphasize: true,
      style: { ...groupedPurpleStyle },
    },
    {
      id: 'onetime-total',
      label: 'One-time Total',
      __astLabelI18n: { i18nKey: 'labels.oneTimeTotal', defaultValue: 'One-time Total' },
      valueExpression: { type: 'binding', bindingId: 'onetimeTotal' },
      format: 'currency',
      emphasize: true,
      style: { ...groupedPurpleStyle },
    },
  ];

  it('T001 initializes row colors from saved styles and edits only the targeted row plus the live canvas', async () => {
    mountTotalsInspectorAndCanvas({ rows: defaultRows });

    // Rows are listed by their imported display labels.
    expect(within(inspectorPanel()).getByText('Monthly Total')).toBeTruthy();
    expect(within(inspectorPanel()).getByText('One-time Total')).toBeTruthy();

    // Controls initialize from the saved inline styles.
    expect(inputByAutomationId('designer-totals-row-monthly-total-background-value').value).toBe('#7c45d3');
    expect(inputByAutomationId('designer-totals-row-monthly-total-text-value').value).toBe('#ffffff');
    expect(inputByAutomationId('designer-totals-row-onetime-total-background-value').value).toBe('#7c45d3');

    // The live canvas renders both saved rows with their colors.
    await waitFor(() => {
      const monthlyRow = canvasRow('monthly-total');
      const onetimeRow = canvasRow('onetime-total');
      expect(monthlyRow).toBeTruthy();
      expect(onetimeRow).toBeTruthy();
    });

    const monthlyCanvasRow = canvasRow('monthly-total');
    expect(monthlyCanvasRow).toBeTruthy();
    if (monthlyCanvasRow) {
      expect(within(monthlyCanvasRow).getByText('Monthly Total')).toBeTruthy();
      expect(monthlyCanvasRow.style.backgroundColor).toBe('rgb(124, 69, 211)');
      expect(monthlyCanvasRow.style.color).toBe('rgb(255, 255, 255)');
    }

    // Change only the monthly row's text color and commit on blur.
    const monthlyText = inputByAutomationId('designer-totals-row-monthly-total-text-value');
    fireEvent.change(monthlyText, { target: { value: '#16a34a' } });
    fireEvent.blur(monthlyText, { target: { value: '#16a34a' } });

    await waitFor(() => {
      const rows = totalsRows();
      expect(rows.find((row) => row.id === 'monthly-total')?.style?.inline?.color).toBe('#16a34a');
      expect(rows.find((row) => row.id === 'monthly-total')?.style?.inline?.backgroundColor).toBe('#7c45d3');
    });

    // The sibling row keeps its untouched colors and the canvas reflects only the edited row.
    const updatedRows = totalsRows();
    expect(updatedRows.find((row) => row.id === 'onetime-total')?.style?.inline?.color).toBe('#ffffff');
    expect(updatedRows.find((row) => row.id === 'onetime-total')?.style?.inline?.backgroundColor).toBe('#7c45d3');

    await waitFor(() => {
      const updatedMonthly = canvasRow('monthly-total');
      expect(updatedMonthly?.style.color).toBe('rgb(22, 163, 74)');
    });
    const updatedMonthly = canvasRow('monthly-total');
    expect(updatedMonthly?.style.backgroundColor).toBe('rgb(124, 69, 211)');
    expect(canvasRow('onetime-total')?.style.color).toBe('rgb(255, 255, 255)');
  });

  it('T002 clearing colors restores inheritance while preserving padding/margin/radius, labelStyle, and sibling rows', async () => {
    const rows: RowFixture[] = [
      {
        id: 'monthly-total',
        label: 'Monthly Total',
        valueExpression: { type: 'binding', bindingId: 'recurringTotal' },
        format: 'currency',
        emphasize: true,
        style: { ...groupedPurpleStyle },
        labelStyle: { inline: { fontWeight: '700' } },
      },
      {
        id: 'onetime-total',
        label: 'One-time Total',
        valueExpression: { type: 'binding', bindingId: 'onetimeTotal' },
        format: 'currency',
        emphasize: true,
        style: { inline: { backgroundColor: '#7c45d3', color: '#ffffff' } },
      },
    ];
    mountTotalsInspectorAndCanvas({ rows });

    // Clear the monthly row background only.
    const monthlyCard = document.querySelector('[data-automation-id="designer-totals-row-monthly-total-card"]') as HTMLElement;
    expect(monthlyCard).toBeTruthy();
    fireEvent.click(within(monthlyCard).getByRole('button', { name: 'Clear row background color' }));

    await waitFor(() => {
      const monthly = totalsRows().find((row) => row.id === 'monthly-total');
      const inline = monthly?.style?.inline;
      expect(inline).toBeTruthy();
      expect(inline?.backgroundColor).toBeUndefined();
      expect(inline?.color).toBe('#ffffff');
      expect(inline?.padding).toBe('4px 6px');
      expect(inline?.borderRadius).toBe('4px');
      expect(inline?.margin).toBe('2px 0');
      expect(monthly?.labelStyle).toEqual({ inline: { fontWeight: '700' } });
    });

    // Clear the monthly text color: only the color property disappears, decor stays.
    fireEvent.click(within(monthlyCard).getByRole('button', { name: 'Clear row text color' }));
    await waitFor(() => {
      const monthly = totalsRows().find((row) => row.id === 'monthly-total');
      const inline = monthly?.style?.inline;
      expect(inline?.backgroundColor).toBeUndefined();
      expect(inline?.color).toBeUndefined();
      expect(inline?.padding).toBe('4px 6px');
      expect(inline?.borderRadius).toBe('4px');
      expect(inline?.margin).toBe('2px 0');
    });

    // Reset colors on a bare-color row prunes the emptied style wrapper entirely.
    const onetimeCard = document.querySelector('[data-automation-id="designer-totals-row-onetime-total-card"]') as HTMLElement;
    fireEvent.click(within(onetimeCard).getByRole('button', { name: 'Reset colors' }));

    await waitFor(() => {
      const onetime = totalsRows().find((row) => row.id === 'onetime-total');
      expect(onetime?.style).toBeUndefined();
      expect(onetime?.id).toBe('onetime-total');
      expect(onetime?.label).toBe('One-time Total');
      expect(onetime?.valueExpression).toEqual({ type: 'binding', bindingId: 'onetimeTotal' });
    });

    // The decor row still renders with inherited/default colors in the canvas.
    const monthlyCanvas = canvasRow('monthly-total');
    expect(monthlyCanvas?.style.backgroundColor).toBe('');
  });

  it('T003 an explicit label color stays label-only, the amount inherits row text color, and the note is shown', async () => {
    const rows: RowFixture[] = [
      {
        id: 'monthly-total',
        label: 'Monthly Total',
        valueExpression: { type: 'binding', bindingId: 'recurringTotal' },
        format: 'currency',
        emphasize: true,
        style: { inline: { backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px' } },
        labelStyle: { inline: { color: '#facc15' } },
      },
      {
        id: 'onetime-total',
        label: 'One-time Total',
        valueExpression: { type: 'binding', bindingId: 'onetimeTotal' },
        format: 'currency',
        emphasize: true,
        style: { inline: { backgroundColor: '#7c45d3', color: '#ffffff' } },
      },
    ];
    mountTotalsInspectorAndCanvas({ rows });

    const monthlyCard = document.querySelector('[data-automation-id="designer-totals-row-monthly-total-card"]') as HTMLElement;
    expect(within(monthlyCard).getByText(/keeps its own saved color/i)).toBeTruthy();

    // The one-time row has no label override, so no note appears for it.
    const onetimeCard = document.querySelector('[data-automation-id="designer-totals-row-onetime-total-card"]') as HTMLElement;
    expect(within(onetimeCard).queryByText(/keeps its own saved color/i)).toBeNull();

    await waitFor(() => {
      const monthlyCanvas = canvasRow('monthly-total');
      expect(monthlyCanvas).toBeTruthy();
    });

    const monthlyCanvas = canvasRow('monthly-total');
    expect(monthlyCanvas).toBeTruthy();
    if (monthlyCanvas) {
      const labelSpan = monthlyCanvas.querySelector('span:first-child') as HTMLElement;
      const amountSpan = monthlyCanvas.querySelector('span:nth-child(2)') as HTMLElement;
      expect(labelSpan.style.color).toBe('rgb(250, 204, 21)');
      expect(amountSpan.getAttribute('style')).toBeNull();
      expect(monthlyCanvas.style.color).toBe('rgb(255, 255, 255)');
    }

    // Changing the row text color updates only the row color; the label override persists.
    const monthlyText = inputByAutomationId('designer-totals-row-monthly-total-text-value');
    fireEvent.change(monthlyText, { target: { value: '#0f172a' } });
    fireEvent.blur(monthlyText, { target: { value: '#0f172a' } });

    await waitFor(() => {
      const monthly = totalsRows().find((row) => row.id === 'monthly-total');
      expect(monthly?.style?.inline?.color).toBe('#0f172a');
      expect(monthly?.labelStyle).toEqual({ inline: { color: '#facc15' } });
    });
  });

  it('T008 a committed color edit is undoable and restores the prior totalsRows without corrupting rows', async () => {
    mountTotalsInspectorAndCanvas({ rows: defaultRows });

    const monthlyText = inputByAutomationId('designer-totals-row-monthly-total-text-value');
    fireEvent.change(monthlyText, { target: { value: '#16a34a' } });
    fireEvent.blur(monthlyText, { target: { value: '#16a34a' } });

    await waitFor(() => {
      expect(totalsRows().find((row) => row.id === 'monthly-total')?.style?.inline?.color).toBe('#16a34a');
    });

    const historyIndexAfterCommit = useInvoiceDesignerStore.getState().historyIndex;
    expect(historyIndexAfterCommit).toBeGreaterThan(0);

    act(() => {
      useInvoiceDesignerStore.getState().undo();
    });

    const restored = totalsRows();
    expect(restored).toHaveLength(2);
    expect(restored.find((row) => row.id === 'monthly-total')?.style?.inline?.color).toBe('#ffffff');
    expect(restored.find((row) => row.id === 'onetime-total')?.style?.inline?.color).toBe('#ffffff');
    expect(restored.find((row) => row.id === 'monthly-total')?.style?.inline?.backgroundColor).toBe('#7c45d3');
  });
});
