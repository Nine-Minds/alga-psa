// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { DesignerNode } from '../state/designerStore';
import { DesignCanvas } from './DesignCanvas';

const baseNode = (
  overrides: Partial<DesignerNode> & {
    // Convenience inputs for test fixtures; these are written into props.
    name?: string;
    metadata?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    style?: Record<string, unknown>;
    childIds?: string[];
  }
): DesignerNode => {
  const rawProps = overrides.props ?? {};
  const name = overrides.name ?? (rawProps as any).name ?? 'Field';
  const metadata = overrides.metadata ?? (rawProps as any).metadata;
  const layout = overrides.layout ?? (rawProps as any).layout;
  const style = overrides.style ?? (rawProps as any).style;
  const children = overrides.children ?? overrides.childIds ?? [];

  return {
    id: overrides.id ?? 'node-id',
    type: overrides.type ?? 'field',
    props: {
      ...rawProps,
      name,
      ...(metadata ? { metadata } : {}),
      ...(layout ? { layout } : {}),
      ...(style ? { style } : {}),
    },
    position: overrides.position ?? { x: 20, y: 20 },
    size: overrides.size ?? { width: 200, height: 48 },
    baseSize: overrides.baseSize,
    canRotate: overrides.canRotate ?? false,
    allowResize: overrides.allowResize ?? true,
    rotation: overrides.rotation ?? 0,
    layoutPresetId: overrides.layoutPresetId,
    parentId: overrides.parentId ?? 'page-1',
    children,
    allowedChildren: overrides.allowedChildren ?? [],
  };
};

const buildCanvasNodes = (children: DesignerNode[]): DesignerNode[] => [
  baseNode({
    id: 'document-1',
    type: 'document',
    name: 'Document',
    position: { x: 0, y: 0 },
    size: { width: 816, height: 1056 },
    allowResize: false,
    parentId: null,
    childIds: ['page-1'],
    allowedChildren: ['page'],
  }),
  baseNode({
    id: 'page-1',
    type: 'page',
    name: 'Page 1',
    position: { x: 0, y: 0 },
    size: { width: 816, height: 1056 },
    allowResize: false,
    parentId: 'document-1',
    childIds: children.map((child) => child.id),
    allowedChildren: ['field', 'label', 'table', 'dynamic-table', 'totals', 'subtotal', 'tax', 'discount', 'custom-total'],
  }),
  ...children.map((node) => ({ ...node, parentId: 'page-1' })),
];

const previewData: WasmInvoiceViewModel = {
  invoiceNumber: 'INV-770',
  issueDate: '2026-02-01',
  dueDate: '2026-02-15',
  currencyCode: 'USD',
  poNumber: 'PO-9',
  customer: { name: 'Acme', address: '123 Main' },
  tenantClient: { name: 'Northwind MSP', address: '400 SW Main', logoUrl: null },
  items: [
    { id: 'item-1', description: 'Monitoring', quantity: 2, unitPrice: 1000, total: 2000 },
    { id: 'item-2', description: 'Patching', quantity: 1, unitPrice: 500, total: 500 },
  ],
  subtotal: 2500,
  tax: 250,
  total: 2750,
};

describe('DesignCanvas preview mode', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders field bindings from preview data before scaffold fallback', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'field-1',
        type: 'field',
        name: 'Invoice Number',
        metadata: { bindingKey: 'invoice.number', format: 'text' },
      }),
    ]);
    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );
    expect(screen.getByText('INV-770')).toBeTruthy();
  });

  it('falls back to scaffold placeholders when bound value is missing', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'field-2',
        type: 'field',
        name: 'Invoice Number',
        metadata: { bindingKey: 'invoice.unknown', format: 'text' },
      }),
    ]);
    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );
    expect(screen.getByText('INV-000123')).toBeTruthy();
  });

  it('renders totals and table data from preview invoice payload', () => {
    const nodes = buildCanvasNodes([
      baseNode({ id: 'totals-1', type: 'totals', name: 'Totals', size: { width: 280, height: 120 } }),
      baseNode({
        id: 'table-1',
        type: 'dynamic-table',
        name: 'Items',
        position: { x: 20, y: 180 },
        size: { width: 500, height: 220 },
        metadata: {
          columns: [
            { id: 'c1', header: 'Description', key: 'item.description', type: 'text' },
            { id: 'c2', header: 'Qty', key: 'item.quantity', type: 'number' },
            { id: 'c3', header: 'Amount', key: 'item.total', type: 'currency' },
          ],
        },
      }),
    ]);
    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );
    expect(screen.getByText('Subtotal')).toBeTruthy();
    expect(screen.getByText('Tax')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('$25.00')).toBeTruthy();
    expect(screen.getByText('$2.50')).toBeTruthy();
    expect(screen.getByText('$27.50')).toBeTruthy();
    expect(screen.getByText('Monitoring')).toBeTruthy();
    expect(screen.getByText('Patching')).toBeTruthy();
  });

  it('degrades totals rendering gracefully when subtotal/tax/total are absent', () => {
    const nodes = buildCanvasNodes([
      baseNode({ id: 'totals-2', type: 'totals', name: 'Totals', size: { width: 280, height: 120 } }),
    ]);
    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={{ ...previewData, subtotal: null as any, tax: null as any, total: null as any }}
      />
    );
    expect(screen.getAllByText('$0.00').length).toBeGreaterThanOrEqual(3);
  });

  it('renders label metadata text when provided instead of generic scaffold copy', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'label-1',
        type: 'label',
        name: 'Label',
        metadata: { text: 'Client Billing Address' },
      }),
    ]);
    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );
    expect(screen.getByText('Client Billing Address')).toBeTruthy();
  });

  it('renders label nodes as transparent text rather than field-like boxed surfaces', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'label-2',
        type: 'label',
        name: 'Label',
        metadata: { text: 'Invoice Date' },
        position: { x: 20, y: 20 },
        size: { width: 160, height: 28 },
      }),
      baseNode({
        id: 'field-7',
        type: 'field',
        name: 'Invoice Date Value',
        metadata: { bindingKey: 'invoice.issueDate', format: 'text' },
        position: { x: 20, y: 64 },
      }),
    ]);

    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    const labelSurface = screen.getByText('Invoice Date').closest('div');
    const fieldSurface = screen.getByText('2026-02-01').closest('div');

    expect(labelSurface?.className).toContain('bg-transparent');
    expect(labelSurface?.className).not.toContain('bg-slate-50/60');
    expect(fieldSurface?.className).toContain('bg-transparent');
  });

  it('supports field border style variants (none and underline)', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'field-none',
        type: 'field',
        name: 'PO Number',
        metadata: { bindingKey: 'invoice.poNumber', fieldBorderStyle: 'none' },
        position: { x: 20, y: 20 },
      }),
      baseNode({
        id: 'field-underline',
        type: 'field',
        name: 'Issue Date',
        metadata: { bindingKey: 'invoice.issueDate', fieldBorderStyle: 'underline' },
        position: { x: 20, y: 80 },
      }),
    ]);

    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    const noneSurface = screen.getByText('PO-9').closest('div');
    const underlineSurface = screen.getByText('2026-02-01').closest('div');

    expect(noneSurface?.className).toContain('bg-transparent');
    expect(noneSurface?.className).toContain('border-transparent');
    expect(underlineSurface?.className).toContain('border-b');
    expect(underlineSurface?.className).toContain('bg-transparent');
  });

  it('applies table list border preset and explicit typography weights', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'label-weighted',
        type: 'label',
        name: 'Label',
        metadata: { text: 'Billing Contact', fontWeight: 'bold' },
        position: { x: 20, y: 20 },
        size: { width: 180, height: 28 },
      }),
      baseNode({
        id: 'table-list',
        type: 'dynamic-table',
        name: 'Line Items List',
        position: { x: 20, y: 80 },
        size: { width: 520, height: 220 },
        metadata: {
          tableBorderPreset: 'list',
          tableHeaderFontWeight: 'bold',
          tableOuterBorder: true,
          tableRowDividers: false,
          tableColumnDividers: true,
        },
      }),
    ]);

    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    const labelSurface = screen.getByText('Billing Contact').closest('div');
    const listTableRoot = screen.getByText('Description').closest('.rounded-sm');
    const tableHeaderRow = screen.getByText('Description').closest('div');

    expect(labelSurface?.className).toContain('font-bold');
    expect(tableHeaderRow?.className).toContain('font-bold');
    expect(listTableRoot?.className).not.toContain('border-slate-400');
    expect(listTableRoot?.querySelector('.border-r')).toBeNull();
    expect(listTableRoot?.querySelector('.border-b')).toBeTruthy();
  });

  it('applies configured table column widths in preview grid tracks', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'table-widths',
        type: 'dynamic-table',
        name: 'Line Items Widths',
        size: { width: 520, height: 220 },
        metadata: {
          columns: [
            { id: 'c1', header: 'Description', key: 'item.description', type: 'text', width: 320 },
            { id: 'c2', header: 'Qty', key: 'item.quantity', type: 'number', width: 70 },
            { id: 'c3', header: 'Rate', key: 'item.unitPrice', type: 'currency', width: 110 },
            { id: 'c4', header: 'Amount', key: 'item.total', type: 'currency', width: 140 },
          ],
        },
      }),
    ]);

    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    const tableHeaderRow = screen.getByText('Description').closest('div');
    const gridTemplateColumns = tableHeaderRow?.style.gridTemplateColumns ?? '';
    const gridTracks = gridTemplateColumns.split(' ').filter((track) => track.length > 0);

    expect(gridTracks.length).toBe(4);
    expect(new Set(gridTracks).size).toBeGreaterThan(1);
  });

  it('renders table border lines when enabled', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'table-bordered',
        type: 'table',
        name: 'Line Items',
        size: { width: 520, height: 220 },
        metadata: {
          tableOuterBorder: true,
          tableRowDividers: true,
          tableColumnDividers: true,
        },
      }),
    ]);

    const { container } = render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    const borderedTableRoot = screen.getByText('Description').closest('.rounded-sm');
    expect(borderedTableRoot?.className).toContain('border');
    expect(borderedTableRoot?.className).toContain('border-slate-400');
    expect(container.querySelectorAll('.border-r').length).toBeGreaterThan(0);
  });

  it('can disable outer, row, and column borders for table previews', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'table-plain',
        type: 'dynamic-table',
        name: 'Line Items Plain',
        size: { width: 520, height: 220 },
        metadata: {
          tableOuterBorder: false,
          tableRowDividers: false,
          tableColumnDividers: false,
        },
      }),
    ]);

    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    const plainTableRoot = screen.getByText('Description').closest('.rounded-sm');
    expect(plainTableRoot?.className).not.toContain('border border-slate-300');
    expect(plainTableRoot?.querySelector('.border-r')).toBeNull();
    expect(plainTableRoot?.querySelector('.border-b')).toBeNull();
  });

  it('renders valid empty state for table-like components when no items exist', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'table-2',
        type: 'table',
        name: 'Table',
        metadata: {
          columns: [{ id: 'desc', header: 'Description', key: 'item.description', type: 'text' }],
        },
      }),
    ]);
    render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={{ ...previewData, items: [] }}
      />
    );
    expect(screen.getByText('No line items')).toBeTruthy();
  });

  it('enforces read-only interactions and keeps selection deemphasis disabled', () => {
    const onNodeSelect = vi.fn();
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'field-3',
        type: 'field',
        name: 'Invoice Number',
        metadata: { bindingKey: 'invoice.number' },
      }),
      baseNode({
        id: 'field-4',
        type: 'field',
        name: 'Due Date',
        position: { x: 240, y: 20 },
        metadata: { bindingKey: 'invoice.dueDate' },
      }),
    ]);

    const { container } = render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId="field-3"
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={onNodeSelect}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    fireEvent.click(screen.getAllByText('INV-770')[0]);
    expect(onNodeSelect).not.toHaveBeenCalled();
    expect(container.querySelector('.cursor-se-resize')).toBeNull();
    expect(container.querySelector('.opacity-65')).toBeNull();
  });

  it('uses provided canvas scale conventions in preview mode', () => {
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'field-5',
        type: 'field',
        name: 'Invoice Number',
        metadata: { bindingKey: 'invoice.number' },
      }),
    ]);
    const { container } = render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId={null}
        showGuides={false}
        showRulers={true}
        gridSize={8}
        canvasScale={1.25}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={() => undefined}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );
    const scaledContainer = container.querySelector('[style*="scale(1.25)"]');
    expect(scaledContainer).toBeTruthy();
  });

  it('ignores destructive keyboard shortcuts while read-only', () => {
    const onNodeSelect = vi.fn();
    const nodes = buildCanvasNodes([
      baseNode({
        id: 'field-6',
        type: 'field',
        name: 'Invoice Number',
        metadata: { bindingKey: 'invoice.number' },
      }),
    ]);
    const { container } = render(
      <DesignCanvas
        nodes={nodes}
        selectedNodeId="field-6"
        showGuides={false}
        showRulers={false}
        gridSize={8}
        canvasScale={1}
        snapToGrid
        guides={[]}
        isDragActive={false}
        forcedDropTarget={null}
        droppableId="preview"
        onPointerLocationChange={() => undefined}
        onNodeSelect={onNodeSelect}
        onResize={() => undefined}
        readOnly
        previewData={previewData}
      />
    );

    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'Delete' });
    fireEvent.keyDown(container.firstChild as HTMLElement, { key: 'Backspace' });

    expect(onNodeSelect).not.toHaveBeenCalled();
    expect(screen.getAllByText('INV-770').length).toBeGreaterThan(0);
  });
});
