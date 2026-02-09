// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { DesignerNode } from '../state/designerStore';
import { DesignCanvas } from './DesignCanvas';

const baseNode = (overrides: Partial<DesignerNode>): DesignerNode => ({
  id: 'node-id',
  type: 'field',
  name: 'Field',
  position: { x: 20, y: 20 },
  size: { width: 200, height: 48 },
  canRotate: false,
  allowResize: true,
  rotation: 0,
  metadata: {},
  parentId: 'page-1',
  childIds: [],
  allowedChildren: [],
  ...overrides,
});

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
    const scaledContainer = container.querySelector('[style*=\"scale(1.25)\"]');
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
