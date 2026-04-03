// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import TransformsWorkspace from './TransformsWorkspace';
import { importTemplateAstToWorkspace, exportWorkspaceToTemplateAst } from '../ast/workspaceAst';
import { useInvoiceDesignerStore } from '../state/designerStore';
import {
  createInitialPreviewSessionState,
  previewSessionReducer,
} from '../preview/previewSessionState';
import {
  DEFAULT_PREVIEW_SAMPLE_ID,
  getPreviewSampleScenarioById,
} from '../preview/sampleScenarios';

const previewInvoice = {
  invoiceNumber: 'INV-TRANSFORMS-1',
  issueDate: '2026-03-01',
  dueDate: '2026-03-15',
  currencyCode: 'USD',
  poNumber: 'PO-123',
  customer: {
    name: 'Acme Dental',
    address: '123 Main Street',
  },
  tenantClient: {
    name: 'Northwind MSP',
    address: '500 River Road',
    logoUrl: null,
  },
  items: [
    { id: 'line-1', description: 'Monitoring', quantity: 2, unitPrice: 5000, total: 10000, category: 'Service' },
    { id: 'line-2', description: 'Backup', quantity: 1, unitPrice: 3000, total: 3000, category: 'Service' },
    { id: 'line-3', description: 'Hardware', quantity: 1, unitPrice: 20000, total: 20000, category: 'Hardware' },
  ],
  adjustments: [{ id: 'adj-1', description: 'Credit', total: -5000 }],
  subtotal: 28000,
  tax: 2800,
  total: 30800,
  taxSource: 'internal',
} as any;

const loadExistingInvoiceOptions = async () => ({
  options: [{ value: 'inv-1', label: 'INV-1 · Acme Dental' }],
  total: 1,
});

const installWorkspace = () => {
  const workspace = importTemplateAstToWorkspace({
    kind: 'invoice-template-ast',
    version: 1,
    bindings: {
      values: {},
      collections: {
        lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
        adjustments: { id: 'adjustments', kind: 'collection', path: 'adjustments' },
      },
    },
    layout: {
      id: 'root',
      type: 'document',
      children: [],
    },
  } as any);

  act(() => {
    useInvoiceDesignerStore.getState().loadWorkspace(workspace);
  });
};

const renderTransformsWorkspace = () => {
  const Wrapper = () => {
    const [previewState, dispatch] = React.useReducer(
      previewSessionReducer,
      undefined,
      createInitialPreviewSessionState
    );
    const activeSample = getPreviewSampleScenarioById(previewState.selectedSampleId ?? DEFAULT_PREVIEW_SAMPLE_ID);

    return (
      <TransformsWorkspace
        previewState={previewState}
        previewData={previewInvoice}
        activeSample={activeSample}
        onSourceKindChange={(source) => dispatch({ type: 'set-source', source })}
        onSampleChange={(sampleId) => dispatch({ type: 'set-sample', sampleId })}
        onExistingInvoiceChange={(invoiceId) => dispatch({ type: 'select-existing-invoice', invoiceId })}
        onClearExistingInvoice={() => dispatch({ type: 'clear-existing-invoice' })}
        loadExistingInvoiceOptions={loadExistingInvoiceOptions}
      />
    );
  };

  return render(<Wrapper />);
};

const selectCustomOption = async (triggerId: string, optionText: string) => {
  const trigger = document.getElementById(triggerId);
  expect(trigger).toBeTruthy();
  if (!trigger) return;
  await act(async () => {
    fireEvent.click(trigger);
  });
  const options = await screen.findAllByRole('option');
  const option = options.find((candidate) => candidate.textContent?.trim() === optionText) ?? null;
  expect(option).toBeTruthy();
  if (!option) return;
  await act(async () => {
    fireEvent.click(option);
  });
};

describe('TransformsWorkspace', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: () => undefined,
    });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: () => undefined,
      configurable: true,
    });
    useInvoiceDesignerStore.getState().resetWorkspace();
    installWorkspace();
  });

  afterEach(() => {
    useInvoiceDesignerStore.getState().resetWorkspace();
  });

  it('lists collection bindings and updates source metadata when the source selection changes', async () => {
    renderTransformsWorkspace();

    await selectCustomOption('invoice-designer-transforms-source-binding', 'lineItems (items)');
    await waitFor(() => expect(screen.getAllByText('3 rows').length).toBeGreaterThan(0));
    expect(screen.getAllByText('description').length).toBeGreaterThan(0);
    expect(screen.getAllByText('quantity').length).toBeGreaterThan(0);

    await selectCustomOption('invoice-designer-transforms-source-binding', 'adjustments (adjustments)');
    await waitFor(() => expect(screen.getAllByText('1 rows').length).toBeGreaterThan(0));
    expect(useInvoiceDesignerStore.getState().transforms.sourceBindingId).toBe('adjustments');
  });

  it('adds a sort operation, selects it for editing, and preserves authored key order in the exported AST', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.transformed',
        operations: [],
      });
    });

    renderTransformsWorkspace();

    fireEvent.click(screen.getAllByRole('button', { name: '+ Sort' })[0]!);
    expect(screen.getAllByText('Sort key 1').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: '+ Sort key' })[0]!);
    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations[0]).toMatchObject({
        type: 'sort',
        keys: [{ path: 'category' }, { path: 'category' }],
      })
    );

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    expect(ast.transforms?.operations[0]).toMatchObject({
      type: 'sort',
      keys: [{ path: 'category' }, { path: 'category' }],
    });
  });

  it('duplicates and deletes operations while keeping a valid selected inspector target', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.transformed',
        operations: [
          {
            id: 'sort-total',
            type: 'sort',
            keys: [{ path: 'total', direction: 'desc' }],
          },
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
        ],
      });
    });

    renderTransformsWorkspace();

    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate sort-total' })[0]!);
    await waitFor(() => expect(useInvoiceDesignerStore.getState().transforms.operations).toHaveLength(3));
    const duplicateIds = useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id);
    expect(new Set(duplicateIds).size).toBe(3);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete group-category' })[0]!);
    await waitFor(() => expect(useInvoiceDesignerStore.getState().transforms.operations).toHaveLength(2));
    expect(screen.getAllByText(/Sort key 1/).length).toBeGreaterThan(0);
  });

  it('edits filter field, operator, and value and exports the updated predicate', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.filtered',
        operations: [
          {
            id: 'filter-positive',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'total',
              op: 'gt',
              value: 0,
            },
          },
        ],
      });
    });

    renderTransformsWorkspace();

    await selectCustomOption('transform-filter-field-filter-positive', 'quantity');
    await selectCustomOption('transform-filter-operator-filter-positive', 'Greater or equal');

    const valueInput = screen
      .getAllByRole('textbox')
      .find((element) => (element as HTMLInputElement).value === '0') as HTMLInputElement | undefined;
    expect(valueInput).toBeTruthy();
    if (!valueInput) return;

    fireEvent.change(valueInput, { target: { value: '2' } });
    fireEvent.blur(valueInput);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations[0]).toMatchObject({
        type: 'filter',
        predicate: {
          path: 'quantity',
          op: 'gte',
          value: 2,
        },
      })
    );

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    expect(ast.transforms?.operations[0]).toMatchObject({
      type: 'filter',
      predicate: {
        path: 'quantity',
        op: 'gte',
        value: 2,
      },
    });
  });

  it('reorders transforms and preserves the exported AST operation order', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.ordered',
        operations: [
          {
            id: 'filter-positive',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'total',
              op: 'gt',
              value: 0,
            },
          },
          {
            id: 'sort-total',
            type: 'sort',
            keys: [{ path: 'total', direction: 'desc' }],
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    fireEvent.click(screen.getAllByRole('button', { name: 'Move sort-total up' })[0]!);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id)).toEqual([
        'sort-total',
        'filter-positive',
        'aggregate-total',
      ])
    );

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    expect(ast.transforms?.operations.map((operation) => operation.id)).toEqual([
      'sort-total',
      'filter-positive',
      'aggregate-total',
    ]);
  });

  it('edits group inspector fields and aggregate definitions with live preview updates', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
            label: 'Category',
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();
    expect(screen.getAllByText('aggregates.sumTotal').length).toBeGreaterThan(0);

    await selectCustomOption('transform-group-key-group-category', 'description');
    const labelInput = screen
      .getAllByRole('textbox')
      .find((element) => (element as HTMLInputElement).value === 'Category') as HTMLInputElement | undefined;
    expect(labelInput).toBeTruthy();
    if (!labelInput) return;
    fireEvent.change(labelInput, { target: { value: 'Description rollup' } });
    fireEvent.blur(labelInput);

    fireEvent.click(screen.getAllByRole('button', { name: /aggregate sum total -> sumTotal/i })[0]!);
    fireEvent.click(screen.getByRole('button', { name: '+ Aggregation' }));
    await waitFor(() =>
      expect(
        (useInvoiceDesignerStore.getState().transforms.operations[1] as any).aggregations.map((entry: any) => entry.id)
      ).toEqual(['sumTotal', 'agg2'])
    );

    const aggregateIdInput = screen
      .getAllByRole('textbox')
      .find((element) => (element as HTMLInputElement).value === 'agg2') as HTMLInputElement | undefined;
    expect(aggregateIdInput).toBeTruthy();
    if (!aggregateIdInput) return;
    fireEvent.change(aggregateIdInput, { target: { value: 'countItems' } });
    fireEvent.blur(aggregateIdInput);
    await selectCustomOption('transform-aggregate-op-aggregate-total-1', 'Count');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);

    await waitFor(() =>
      expect((useInvoiceDesignerStore.getState().transforms.operations[0] as any).key).toBe('description')
    );
    await waitFor(() =>
      expect((useInvoiceDesignerStore.getState().transforms.operations[1] as any).aggregations).toEqual([
        { id: 'countItems', op: 'count' },
      ])
    );

    expect(screen.getAllByText('aggregates.countItems').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Monitoring/).length).toBeGreaterThan(0);

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    expect(ast.transforms?.operations).toMatchObject([
      {
        id: 'group-category',
        type: 'group',
        key: 'description',
        label: 'Description rollup',
      },
      {
        id: 'aggregate-total',
        type: 'aggregate',
        aggregations: [{ id: 'countItems', op: 'count' }],
      },
    ]);
  });

  it('renders flat output preview rows when the pipeline does not group', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.filtered',
        operations: [
          {
            id: 'filter-positive',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'quantity',
              op: 'gte',
              value: 1,
            },
          },
          {
            id: 'sort-total',
            type: 'sort',
            keys: [{ path: 'total', direction: 'desc' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    expect(screen.getAllByText('3 rows').length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/grouped rows/)).toHaveLength(0);
    expect(screen.getAllByText(/"description": "Hardware"/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/"description": "Monitoring"/).length).toBeGreaterThan(0);
  });

  it('renders grouped output preview with grouped row paths when the pipeline groups and aggregates', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    expect(screen.getAllByText(/grouped rows/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('key').length).toBeGreaterThan(0);
    expect(screen.getAllByText('aggregates.sumTotal').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/items$/).length).toBeGreaterThan(0);
  });

  it('surfaces invalid transform sequence errors inline before save/export', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.invalid',
        operations: [
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
          {
            id: 'sort-after-group',
            type: 'sort',
            keys: [{ path: 'total', direction: 'desc' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    expect(screen.getAllByText(/cannot run after grouped output/i).length).toBeGreaterThan(0);
  });

  it('does not surface false-positive validation errors for a valid filter-sort-group-aggregate pipeline', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.valid',
        operations: [
          {
            id: 'filter-positive',
            type: 'filter',
            predicate: {
              type: 'comparison',
              path: 'total',
              op: 'gt',
              value: 0,
            },
          },
          {
            id: 'sort-total',
            type: 'sort',
            keys: [{ path: 'total', direction: 'desc' }],
          },
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    expect(screen.queryAllByText(/cannot run after grouped output/i)).toHaveLength(0);

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    expect(ast.transforms?.operations.map((operation) => operation.type)).toEqual([
      'filter',
      'sort',
      'group',
      'aggregate',
    ]);
  });

  it('round-trips an updated group and aggregate pipeline and preserves the preview shape after reopen', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'group-category',
            type: 'group',
            key: 'category',
          },
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    await selectCustomOption('transform-group-key-group-category', 'description');
    fireEvent.click(screen.getAllByRole('button', { name: /aggregate sum total -> sumTotal/i })[0]!);

    const aggregateIdInput = screen
      .getAllByRole('textbox')
      .find((element) => (element as HTMLInputElement).value === 'sumTotal') as HTMLInputElement | undefined;
    expect(aggregateIdInput).toBeTruthy();
    if (!aggregateIdInput) {
      return;
    }
    fireEvent.change(aggregateIdInput, { target: { value: 'lineCount' } });
    fireEvent.blur(aggregateIdInput);
    await selectCustomOption('transform-aggregate-op-aggregate-total-0', 'Count');

    const savedAst = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());

    act(() => {
      useInvoiceDesignerStore.getState().resetWorkspace();
      useInvoiceDesignerStore.getState().loadWorkspace(importTemplateAstToWorkspace(savedAst));
    });

    renderTransformsWorkspace();

    await waitFor(() => expect(screen.getAllByText('aggregates.lineCount').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Monitoring/).length).toBeGreaterThan(0);
    expect(useInvoiceDesignerStore.getState().transforms.operations).toMatchObject([
      { id: 'group-category', type: 'group', key: 'description' },
      {
        id: 'aggregate-total',
        type: 'aggregate',
        aggregations: [{ id: 'lineCount', op: 'count' }],
      },
    ]);
  });

  it('persists output binding edits into workspace and generated AST', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: '',
        operations: [
          {
            id: 'sort-total',
            type: 'sort',
            keys: [{ path: 'total', direction: 'desc' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    const outputInput =
      screen
        .getAllByPlaceholderText('items.transformed')
        .find((element) => element.tagName === 'INPUT') as HTMLInputElement | undefined;
    expect(outputInput).toBeTruthy();
    if (!outputInput) {
      return;
    }
    fireEvent.change(outputInput, { target: { value: 'lineItems.sorted' } });
    fireEvent.blur(outputInput);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.outputBindingId).toBe('lineItems.sorted')
    );

    const ast = exportWorkspaceToTemplateAst(useInvoiceDesignerStore.getState().exportWorkspace());
    expect(ast.transforms?.outputBindingId).toBe('lineItems.sorted');
  });

  it('keeps the output binding input focused while typing before blur commits to store', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'aggregate-total',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    const outputInput =
      screen
        .getAllByPlaceholderText('items.transformed')
        .find((element) => element.tagName === 'INPUT') as HTMLInputElement | undefined;
    expect(outputInput).toBeTruthy();
    if (!outputInput) {
      return;
    }

    outputInput.focus();
    expect(document.activeElement).toBe(outputInput);

    fireEvent.change(outputInput, { target: { value: 'lineItems.grouped.v2' } });
    expect(document.activeElement).toBe(outputInput);
    expect(useInvoiceDesignerStore.getState().transforms.outputBindingId).toBe('lineItems.grouped');

    fireEvent.change(outputInput, { target: { value: 'lineItems.grouped.v3' } });
    expect(document.activeElement).toBe(outputInput);

    fireEvent.blur(outputInput);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.outputBindingId).toBe('lineItems.grouped.v3')
    );
  });

  it('keeps aggregate output ID focused while typing', async () => {
    act(() => {
      useInvoiceDesignerStore.getState().setTransforms({
        sourceBindingId: 'lineItems',
        outputBindingId: 'lineItems.grouped',
        operations: [
          {
            id: 'aggregate-focus',
            type: 'aggregate',
            aggregations: [{ id: 'sumTotal', op: 'sum', path: 'total' }],
          },
        ],
      });
    });

    renderTransformsWorkspace();

    const aggregateIdInput = (await screen.findByDisplayValue('sumTotal')) as HTMLInputElement | null;
    expect(aggregateIdInput).toBeTruthy();
    if (!aggregateIdInput) return;

    aggregateIdInput.focus();
    expect(document.activeElement).toBe(aggregateIdInput);

    fireEvent.change(aggregateIdInput, { target: { value: 'sumTotalNext' } });

    const currentInput = screen.getByDisplayValue('sumTotalNext') as HTMLInputElement | null;
    expect(currentInput).toBeTruthy();
    expect(currentInput?.value).toBe('sumTotalNext');
    expect(document.activeElement).toBe(currentInput);
  });
});
