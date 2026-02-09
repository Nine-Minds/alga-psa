// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInvoiceDesignerStore } from './state/designerStore';
import { DesignerVisualWorkspace } from './DesignerVisualWorkspace';
import type { DesignerNode } from './state/designerStore';

const fetchInvoicesPaginatedMock = vi.fn();
const getInvoiceForRenderingMock = vi.fn();
const mapDbInvoiceToWasmViewModelMock = vi.fn();

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesPaginated: (...args: unknown[]) => fetchInvoicesPaginatedMock(...args),
  getInvoiceForRendering: (...args: unknown[]) => getInvoiceForRenderingMock(...args),
}));

vi.mock('@alga-psa/billing/lib/adapters/invoiceAdapters', () => ({
  mapDbInvoiceToWasmViewModel: (...args: unknown[]) => mapDbInvoiceToWasmViewModelMock(...args),
}));

vi.mock('./DesignerShell', () => ({
  DesignerShell: () => <div data-automation-id="designer-shell-mock">Designer Shell</div>,
}));

const renderWorkspace = (initialTab: 'design' | 'preview' = 'design') => {
  const Wrapper = () => {
    const [tab, setTab] = React.useState<'design' | 'preview'>(initialTab);
    return <DesignerVisualWorkspace visualWorkspaceTab={tab} onVisualWorkspaceTabChange={setTab} />;
  };
  return render(<Wrapper />);
};

const buildInvoiceListResult = (overrides: Partial<any> = {}) => ({
  invoices: [
    {
      invoice_id: 'inv-1',
      invoice_number: 'INV-001',
      client: { name: 'Acme Co.' },
    },
    {
      invoice_id: 'inv-2',
      invoice_number: 'INV-002',
      client: { name: 'Globex' },
    },
  ],
  total: 2,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  ...overrides,
});

const seedBoundField = (bindingKey: string = 'invoice.number') => {
  act(() => {
    const store = useInvoiceDesignerStore.getState();
    const documentNode: DesignerNode = {
      id: 'doc-1',
      type: 'document',
      name: 'Document',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: null,
      childIds: ['page-1'],
      allowedChildren: ['page'],
    };
    const pageNode: DesignerNode = {
      id: 'page-1',
      type: 'page',
      name: 'Page 1',
      position: { x: 0, y: 0 },
      size: { width: 816, height: 1056 },
      canRotate: false,
      allowResize: false,
      rotation: 0,
      metadata: {},
      parentId: 'doc-1',
      childIds: ['field-1'],
      allowedChildren: ['field', 'label', 'table', 'dynamic-table', 'totals', 'subtotal', 'tax', 'discount', 'custom-total'],
    };
    const fieldNode: DesignerNode = {
      id: 'field-1',
      type: 'field',
      name: 'Invoice Number',
      position: { x: 24, y: 24 },
      size: { width: 220, height: 48 },
      canRotate: false,
      allowResize: true,
      rotation: 0,
      metadata: { bindingKey, format: 'text' },
      parentId: 'page-1',
      childIds: [],
      allowedChildren: [],
    };
    store.loadWorkspace({
      nodes: [documentNode, pageNode, fieldNode],
      constraints: [],
      snapToGrid: true,
      gridSize: 8,
      showGuides: true,
      showRulers: true,
      canvasScale: 1,
    });
    store.selectNode('field-1');
  });
};

afterEach(() => {
  cleanup();
});

describe('DesignerVisualWorkspace', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useInvoiceDesignerStore.getState().resetWorkspace();
    fetchInvoicesPaginatedMock.mockReset();
    getInvoiceForRenderingMock.mockReset();
    mapDbInvoiceToWasmViewModelMock.mockReset();
    fetchInvoicesPaginatedMock.mockResolvedValue(buildInvoiceListResult());
    getInvoiceForRenderingMock.mockResolvedValue({ invoice_id: 'inv-1' });
    mapDbInvoiceToWasmViewModelMock.mockReturnValue({
      invoiceNumber: 'INV-001',
      issueDate: '2026-02-01',
      dueDate: '2026-02-15',
      currencyCode: 'USD',
      poNumber: null,
      customer: { name: 'Acme Co.', address: '123 Main' },
      tenantClient: { name: 'Northwind MSP', address: '400 SW Main', logoUrl: null },
      items: [],
      subtotal: 1000,
      tax: 100,
      total: 1100,
    });
  });

  it('renders Design and Preview tabs with stable automation IDs', async () => {
    renderWorkspace();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-design-tab\"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-tab\"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-design-tab\"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-tab\"]')).toBeTruthy();
  });

  it('defaults to Design view on initial render', async () => {
    renderWorkspace();
    expect(screen.getByText('Designer Shell')).toBeTruthy();
    expect(screen.queryByText('Sample Scenario')).toBeNull();
  });

  it('switches Design -> Preview -> Design without losing workspace nodes', async () => {
    seedBoundField();
    const beforeCount = useInvoiceDesignerStore.getState().nodes.length;

    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByText('Sample Scenario')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Design' }));
    expect(screen.getByText('Designer Shell')).toBeTruthy();

    const afterCount = useInvoiceDesignerStore.getState().nodes.length;
    expect(afterCount).toBe(beforeCount);
  });

  it('updates sample scenario selection while in Sample source mode', async () => {
    renderWorkspace('preview');
    const select = screen.getByLabelText('Sample Scenario') as HTMLSelectElement;
    expect(select.value).toBe('sample-simple-services');
    fireEvent.change(select, { target: { value: 'sample-high-line-count' } });
    expect(select.value).toBe('sample-high-line-count');
    expect(
      document.querySelector('[data-automation-id=\"invoice-designer-preview-sample-description\"]')?.textContent
    ).toContain('Large invoice');
  });

  it('exposes stable automation IDs for source and selector controls', async () => {
    renderWorkspace('preview');
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-source-toggle\"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-source-sample\"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-source-existing\"]')).toBeTruthy();
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-sample-select\"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await waitFor(() => {
      expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-existing-search\"]')).toBeTruthy();
      expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-existing-select\"]')).toBeTruthy();
      expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-existing-clear\"]')).toBeTruthy();
    });
  });

  it('hides existing-invoice controls in Sample mode and shows them in Existing mode', async () => {
    renderWorkspace('preview');
    expect(screen.queryByPlaceholderText('Search by invoice number or client...')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search by invoice number or client...')).toBeTruthy();
    });
  });

  it('calls paginated invoice search with status=all and query filters', async () => {
    renderWorkspace('preview');
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));

    await waitFor(() => expect(fetchInvoicesPaginatedMock).toHaveBeenCalled());
    expect(fetchInvoicesPaginatedMock.mock.calls.at(-1)?.[0]).toMatchObject({
      status: 'all',
      page: 1,
      pageSize: 10,
    });

    const searchInput = await screen.findByPlaceholderText('Search by invoice number or client...');
    fireEvent.change(searchInput, { target: { value: 'globex' } });

    await waitFor(() => {
      expect(fetchInvoicesPaginatedMock.mock.calls.at(-1)?.[0]).toMatchObject({
        searchTerm: 'globex',
        status: 'all',
      });
    }, { timeout: 2500 });
  });

  it('supports existing invoice pagination transitions', async () => {
    fetchInvoicesPaginatedMock.mockResolvedValue(buildInvoiceListResult({ totalPages: 3 }));
    renderWorkspace('preview');
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeTruthy());
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => {
      expect(fetchInvoicesPaginatedMock.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2 });
    });
  });

  it('loads selected existing invoice detail and maps it for preview', async () => {
    renderWorkspace('preview');
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    const select = await screen.findByLabelText('Select Invoice');
    fireEvent.change(select, { target: { value: 'inv-1' } });

    await waitFor(() => expect(getInvoiceForRenderingMock).toHaveBeenCalledWith('inv-1'));
    await waitFor(() => expect(mapDbInvoiceToWasmViewModelMock).toHaveBeenCalled());
  });

  it('guards against stale detail responses when selected invoice changes quickly', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    getInvoiceForRenderingMock
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    renderWorkspace('preview');
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    const select = await screen.findByLabelText('Select Invoice');
    fireEvent.change(select, { target: { value: 'inv-1' } });
    fireEvent.change(select, { target: { value: 'inv-2' } });

    resolveFirst({ invoice_id: 'inv-1' });
    resolveSecond({ invoice_id: 'inv-2' });

    await waitFor(() => {
      expect(mapDbInvoiceToWasmViewModelMock).toHaveBeenCalledTimes(1);
    });
  });

  it('renders loading, empty, and error states for existing invoice list', async () => {
    fetchInvoicesPaginatedMock.mockImplementationOnce(
      () => new Promise(() => undefined) // never resolves for loading snapshot
    );
    renderWorkspace('preview');
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await waitFor(() => {
      expect(
        document.querySelector('[data-automation-id=\"invoice-designer-preview-existing-loading\"]')
      ).toBeTruthy();
    });

    fetchInvoicesPaginatedMock.mockResolvedValueOnce(buildInvoiceListResult({ invoices: [], total: 0, totalPages: 0 }));
    fireEvent.change(screen.getByPlaceholderText('Search by invoice number or client...'), { target: { value: 'x' } });
    await waitFor(() => {
      expect(
        document.querySelector('[data-automation-id=\"invoice-designer-preview-existing-empty\"]')
      ).toBeTruthy();
    });

    fetchInvoicesPaginatedMock.mockRejectedValueOnce(new Error('Search failed'));
    fireEvent.change(screen.getByPlaceholderText('Search by invoice number or client...'), { target: { value: 'y' } });
    await waitFor(() => {
      expect(
        document.querySelector('[data-automation-id=\"invoice-designer-preview-existing-error\"]')
      ).toBeTruthy();
    });
  });

  it('clears selected existing invoice when reset action is used', async () => {
    renderWorkspace('preview');
    fireEvent.click(screen.getByText('Existing'));
    const select = await screen.findByLabelText('Select Invoice');
    fireEvent.change(select, { target: { value: 'inv-1' } });
    await waitFor(() => expect(getInvoiceForRenderingMock).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Clear'));
    expect((screen.getByLabelText('Select Invoice') as HTMLSelectElement).value).toBe('');
  });

  it('recomputes preview after metadata changes and debounces rapid edits', async () => {
    seedBoundField('invoice.number');
    renderWorkspace('preview');
    await waitFor(() => expect(screen.getByText('INV-2026-0147')).toBeTruthy());

    const nodeId = useInvoiceDesignerStore.getState().selectedNodeId;
    expect(nodeId).toBeTruthy();
    act(() => {
      useInvoiceDesignerStore.getState().updateNodeMetadata(nodeId!, { bindingKey: 'invoice.poNumber', format: 'text' });
      useInvoiceDesignerStore.getState().updateNodeMetadata(nodeId!, { bindingKey: 'customer.name', format: 'text' });
    });

    // Debounce should delay preview refresh.
    expect(screen.queryByText('Blue Harbor Dental')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    expect(screen.getByText('Blue Harbor Dental')).toBeTruthy();
  });

  it('recomputes preview when layout structure changes affect rendered output', async () => {
    seedBoundField('invoice.number');
    renderWorkspace('preview');
    await waitFor(() => expect(screen.getAllByText('INV-2026-0147').length).toBeGreaterThan(0));
    expect(screen.queryByText('Managed Endpoint Monitoring')).toBeNull();

    act(() => {
      const store = useInvoiceDesignerStore.getState();
      const workspace = store.exportWorkspace();
      const pageNode = workspace.nodes.find((node) => node.type === 'page');
      if (!pageNode) {
        return;
      }
      const tableNode: DesignerNode = {
        id: 'table-layout-change',
        type: 'table',
        name: 'Items Table',
        position: { x: 32, y: 120 },
        size: { width: 420, height: 180 },
        canRotate: false,
        allowResize: true,
        rotation: 0,
        metadata: {
          columns: [{ id: 'desc', header: 'Description', key: 'item.description', type: 'text' }],
        },
        parentId: pageNode.id,
        childIds: [],
        allowedChildren: [],
      };

      store.loadWorkspace({
        ...workspace,
        nodes: workspace.nodes
          .map((node) =>
            node.id === pageNode.id ? { ...node, childIds: [...node.childIds, tableNode.id] } : node
          )
          .concat(tableNode),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Managed Endpoint Monitoring')).toBeTruthy();
    }, { timeout: 2500 });
  });

  it('refreshes preview output when switching Sample -> Existing -> Sample', async () => {
    seedBoundField('invoice.number');
    mapDbInvoiceToWasmViewModelMock.mockReturnValue({
      invoiceNumber: 'INV-EXISTING-001',
      issueDate: '2026-02-01',
      dueDate: '2026-02-15',
      currencyCode: 'USD',
      poNumber: null,
      customer: { name: 'Existing Customer', address: '123 Main' },
      tenantClient: { name: 'Northwind MSP', address: '400 SW Main', logoUrl: null },
      items: [],
      subtotal: 1000,
      tax: 100,
      total: 1100,
    });

    renderWorkspace('preview');
    await waitFor(() => expect(screen.getAllByText('INV-2026-0147').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    const select = await screen.findByLabelText('Select Invoice');
    fireEvent.change(select, { target: { value: 'inv-1' } });
    await waitFor(() => expect(screen.getAllByText('INV-EXISTING-001').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: 'Sample' }));
    await waitFor(() => expect(screen.getAllByText('INV-2026-0147').length).toBeGreaterThan(0));
  });
});
