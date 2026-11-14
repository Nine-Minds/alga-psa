// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import type { DesignerNode } from '../state/designerStore';
import { DesignCanvas } from './DesignCanvas';
import { getPreviewSampleScenarioById } from '../preview/sampleScenarios';
import { buildBundleChildRowsPreset } from '../../../lib/invoice-template-ast/bundleChildRows';

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


const columns = [
  { id: 'description', header: 'Description', key: 'item.description', type: 'text' },
  { id: 'quantity', header: 'Qty', key: 'item.quantity', type: 'number' },
  { id: 'unit-price', header: 'Rate', key: 'item.unitPrice', type: 'currency' },
  { id: 'line-total', header: 'Amount', key: 'item.total', type: 'currency' },
];

const renderTable = (metadata: Record<string, unknown>) => {
  const sample = getPreviewSampleScenarioById('sample-managed-services-bundles')!.data;
  const nodes = buildCanvasNodes([
    baseNode({
      id: 'table-1', type: 'dynamic-table', name: 'Items',
      position: { x: 20, y: 20 }, size: { width: 700, height: 400 },
      metadata: { columns, ...metadata },
    }),
  ]);
  return render(
    <DesignCanvas
      nodes={nodes} selectedNodeId={null} showGuides={false} showRulers={false} gridSize={8}
      canvasScale={1} snapToGrid guides={[]} isDragActive={false} forcedDropTarget={null}
      droppableId="preview" onPointerLocationChange={() => undefined} onNodeSelect={() => undefined}
      onResize={() => undefined} readOnly previewData={sample}
    />
  );
};

describe('DesignCanvas bundle component rows (F053/F055)', () => {
  afterEach(() => cleanup());

  it('shows component rows with +/- change from the active sample', () => {
    const { container } = renderTable({ bundleChildRows: buildBundleChildRowsPreset({ prices: true, showChange: true }) });
    expect(screen.getByText('Managed User Seat')).toBeTruthy();
    expect(screen.getByText('Cloud Backup')).toBeTruthy();
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByText('\u22121')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="canvas-bundle-component-row"]').length).toBe(6);
  });

  it('shows no component rows without the childRows config', () => {
    const { container } = renderTable({});
    expect(container.querySelectorAll('[data-testid="canvas-bundle-component-row"]').length).toBe(0);
    expect(screen.getByText('Managed IT Services')).toBeTruthy();
  });
});
