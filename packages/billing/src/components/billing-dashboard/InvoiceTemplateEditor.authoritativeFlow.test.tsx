// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import type { DesignerWorkspaceSnapshot } from '../invoice-designer/state/designerStore';
import { useInvoiceDesignerStore } from '../invoice-designer/state/designerStore';

const pushMock = vi.fn();
const getInvoiceTemplateMock = vi.fn();
const saveInvoiceTemplateMock = vi.fn();
const fetchInvoicesPaginatedMock = vi.fn();
const getInvoiceForRenderingMock = vi.fn();
const mapDbInvoiceToWasmViewModelMock = vi.fn();
const runAuthoritativeInvoiceTemplatePreviewMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ toString: () => '', get: () => null }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplate: (...args: unknown[]) => getInvoiceTemplateMock(...args),
  saveInvoiceTemplate: (...args: unknown[]) => saveInvoiceTemplateMock(...args),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesPaginated: (...args: unknown[]) => fetchInvoicesPaginatedMock(...args),
  getInvoiceForRendering: (...args: unknown[]) => getInvoiceForRenderingMock(...args),
}));

vi.mock('@alga-psa/billing/lib/adapters/invoiceAdapters', () => ({
  mapDbInvoiceToWasmViewModel: (...args: unknown[]) => mapDbInvoiceToWasmViewModelMock(...args),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplatePreview', () => ({
  runAuthoritativeInvoiceTemplatePreview: (...args: unknown[]) =>
    runAuthoritativeInvoiceTemplatePreviewMock(...args),
}));

vi.mock('@monaco-editor/react', () => ({
  Editor: (props: { value?: string; onChange?: (value: string) => void }) => (
    <textarea
      data-testid="monaco-mock"
      value={props.value ?? ''}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  ),
}));

vi.mock('../invoice-designer/DesignerShell', () => ({
  DesignerShell: () => <div data-testid="designer-shell-mock">Designer Shell</div>,
}));

const installLocalStorageMock = () => {
  const backing = new Map<string, string>();
  const storageMock: Storage = {
    get length() {
      return backing.size;
    },
    clear: () => backing.clear(),
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    key: (index: number) => Array.from(backing.keys())[index] ?? null,
    removeItem: (key: string) => {
      backing.delete(key);
    },
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storageMock,
    configurable: true,
  });
};

const createWorkspaceWithField = (fieldId: string): DesignerWorkspaceSnapshot => {
  const base = useInvoiceDesignerStore.getState().exportWorkspace();
  const pageNode = base.nodes.find((node) => node.type === 'page');
  if (!pageNode) {
    return base;
  }

  const fieldNode = {
    id: fieldId,
    type: 'field' as const,
    name: 'Invoice Number',
    position: { x: 24, y: 24 },
    size: { width: 220, height: 48 },
    canRotate: false,
    allowResize: true,
    rotation: 0,
    metadata: { bindingKey: 'invoice.number', format: 'text' },
    parentId: pageNode.id,
    childIds: [],
    allowedChildren: [],
  };

  return {
    ...base,
    nodes: base.nodes
      .map((node) =>
        node.id === pageNode.id
          ? {
              ...node,
              childIds: [...node.childIds, fieldId],
            }
          : node
      )
      .concat(fieldNode),
  };
};

describe('InvoiceTemplateEditor authoritative preview flow', () => {
  beforeEach(() => {
    installLocalStorageMock();
    pushMock.mockReset();
    getInvoiceTemplateMock.mockReset();
    saveInvoiceTemplateMock.mockReset();
    fetchInvoicesPaginatedMock.mockReset();
    getInvoiceForRenderingMock.mockReset();
    mapDbInvoiceToWasmViewModelMock.mockReset();
    runAuthoritativeInvoiceTemplatePreviewMock.mockReset();
    useInvoiceDesignerStore.getState().resetWorkspace();

    getInvoiceTemplateMock.mockResolvedValue({
      template_id: 'tpl-flow',
      name: 'Template Flow',
      assemblyScriptSource: '// existing source',
      isStandard: false,
    });

    saveInvoiceTemplateMock.mockResolvedValue({ success: true });

    fetchInvoicesPaginatedMock.mockResolvedValue({
      invoices: [{ invoice_id: 'inv-existing-1', invoice_number: 'INV-EX-001', client: { name: 'Acme Co.' } }],
      total: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });

    getInvoiceForRenderingMock.mockResolvedValue({ invoice_id: 'inv-existing-1' });
    mapDbInvoiceToWasmViewModelMock.mockReturnValue({
      invoiceNumber: 'INV-EX-001',
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

    runAuthoritativeInvoiceTemplatePreviewMock.mockImplementation(async ({ invoiceData }: any) => ({
      success: true,
      sourceHash: 'hash-flow',
      generatedSource: '// generated',
      compile: {
        status: 'success',
        cacheHit: false,
        diagnostics: [],
      },
      render: {
        status: 'success',
        html: `<div>${invoiceData?.invoiceNumber ?? 'N/A'}</div>`,
        css: '',
      },
      verification: {
        status: 'pass',
        mismatches: [],
      },
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('covers design edit -> authoritative preview -> verification -> save', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-flow" />);

    await waitFor(() =>
      expect(document.querySelector('[data-automation-id=\"invoice-template-editor-visual-tab\"]')).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));

    await waitFor(() => expect(runAuthoritativeInvoiceTemplatePreviewMock).toHaveBeenCalled());
    const baselinePreviewCalls = runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length;

    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(createWorkspaceWithField('field-flow'));
    });

    await waitFor(() => {
      expect(runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length).toBeGreaterThan(baselinePreviewCalls);
      const hasUpdatedWorkspaceCall = runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.some((call) =>
        call[0].workspace.nodes.some((node: { id: string }) => node.id === 'field-flow')
      );
      expect(hasUpdatedWorkspaceCall).toBe(true);
    }, { timeout: 2500 });

    await waitFor(() => {
      expect(
        document.querySelector('[data-automation-id=\"invoice-designer-preview-verification-badge\"]')?.textContent
      ).toContain('pass');
    });
    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-render-iframe\"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalledTimes(1));
    const payload = saveInvoiceTemplateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      template_id: 'tpl-flow',
      name: 'Template Flow',
    });
    expect(payload.templateAst).toMatchObject({
      kind: 'invoice-template-ast',
      version: 1,
    });
    expect(JSON.stringify(payload.templateAst)).toContain('field-flow');
    expect(payload.assemblyScriptSource).toContain('ALGA_INVOICE_DESIGNER_STATE_V1');
  });

  it('updates authoritative preview when switching to existing invoice data', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-flow" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(runAuthoritativeInvoiceTemplatePreviewMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    const select = await screen.findByLabelText('Select Invoice');
    fireEvent.change(select, { target: { value: 'inv-existing-1' } });

    await waitFor(() => expect(getInvoiceForRenderingMock).toHaveBeenCalledWith('inv-existing-1'));
    await waitFor(() =>
      expect(runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.at(-1)?.[0].invoiceData.invoiceNumber).toBe(
        'INV-EX-001'
      )
    );

    const iframe = document.querySelector('[data-automation-id=\"invoice-designer-preview-render-iframe\"]');
    expect(iframe?.getAttribute('srcdoc') ?? iframe?.getAttribute('srcDoc')).toContain('INV-EX-001');
  });
});
