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

// Exercise the existing feature behavior with the release flag enabled.
vi.mock('@alga-psa/ui/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => ({ enabled: true, loading: false, error: null }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({ toString: () => '', get: () => null }),
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplate: (...args: unknown[]) => getInvoiceTemplateMock(...args),
  saveInvoiceTemplate: (...args: unknown[]) => saveInvoiceTemplateMock(...args),
}));

vi.mock('@alga-psa/billing/actions/invoiceQueries', () => ({
  fetchInvoicesPaginated: (...args: unknown[]) => fetchInvoicesPaginatedMock(...args),
  getInvoiceForRendering: (...args: unknown[]) => getInvoiceForRenderingMock(...args),
}));

vi.mock('@alga-psa/billing/lib/adapters/invoiceAdapters', async (importOriginal) => ({
  // sampleScenarios.ts calls enrichWithGroupedItems and buildInvoiceTimeCollections
  // at module load; keep the real pure helpers so new exports never break this mock.
  ...(await importOriginal<typeof import('@alga-psa/billing/lib/adapters/invoiceAdapters')>()),
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
  const pageNode = Object.values(base.nodesById).find((node) => node.type === 'page');
  if (!pageNode) {
    return base;
  }

  return {
    ...base,
    nodesById: {
      ...base.nodesById,
      [pageNode.id]: {
        ...base.nodesById[pageNode.id],
        children: [...(base.nodesById[pageNode.id]?.children ?? []), fieldId],
      },
      [fieldId]: {
        id: fieldId,
        type: 'field',
        props: {
          name: 'Invoice Number',
          metadata: { bindingKey: 'invoice.number', format: 'text' },
        },
        children: [],
      },
    },
  };
};

// The preview panel now holds two comboboxes — the existing-invoice picker and
// the preview-language select — so target the picker by component rather than
// by role. `combobox` takes no name from content, so it has no accessible name.
const openExistingInvoiceSelect = async () => {
  const trigger = await waitFor(() => {
    const element = document.querySelector(
      '[data-automation-type="async-searchable-select"] button[role="combobox"]'
    );
    if (!element) throw new Error('Existing-invoice select is not rendered');
    return element as HTMLElement;
  });
  fireEvent.click(trigger);
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
      templateAst: {
        kind: 'invoice-template-ast',
        version: 1,
        layout: { id: 'root', type: 'document', children: [] },
      },
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

  it('covers design edit -> authoritative preview -> save', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-flow" />);

    await waitFor(() =>
      expect(document.querySelector('[data-automation-id=\"invoice-template-editor-visual-tab\"]')).toBeTruthy()
    );
    expect(screen.getByRole('tab', { name: 'Design' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Transforms' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));

    await waitFor(() => expect(runAuthoritativeInvoiceTemplatePreviewMock).toHaveBeenCalled());
    const baselinePreviewCalls = runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length;

    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(createWorkspaceWithField('field-flow'));
    });

    await waitFor(() => {
      expect(runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length).toBeGreaterThan(baselinePreviewCalls);
      const hasUpdatedWorkspaceCall = runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.some((call) =>
        Boolean(call[0].workspace.nodesById?.['field-flow'])
      );
      expect(hasUpdatedWorkspaceCall).toBe(true);
    }, { timeout: 2500 });

    expect(document.querySelector('[data-automation-id=\"invoice-designer-preview-render-template\"]')).toBeTruthy();

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
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect((document.getElementById('save-template-button') as HTMLButtonElement).disabled).toBe(true);
    const callsAfterSave = runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length;
    await act(async () => {
      useInvoiceDesignerStore.getState().loadWorkspace(createWorkspaceWithField('field-after-save'));
      await new Promise(resolve => setTimeout(resolve, 200));
    });
    expect(runAuthoritativeInvoiceTemplatePreviewMock).toHaveBeenCalledTimes(callsAfterSave);
  });

  it('resumes editing and preview when saving fails', async () => {
    const loadedTemplate = await getInvoiceTemplateMock();
    let finishLoad!: (result: unknown) => void;
    getInvoiceTemplateMock.mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    let finishSave!: (result: unknown) => void;
    saveInvoiceTemplateMock.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    render(<InvoiceTemplateEditor templateId="tpl-flow" />);
    await waitFor(() => expect(runAuthoritativeInvoiceTemplatePreviewMock).toHaveBeenCalled());
    // Preview can dispatch before the separate template load completes. Its
    // invocation is not a signal that Save is ready (the CI race).
    expect(screen.queryByRole('button', { name: 'Save Template' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finishLoad(loadedTemplate); });
    const save = await screen.findByRole('button', { name: 'Save Template' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalledTimes(1));
    expect(save.disabled).toBe(true);
    const previewCalls = runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length;
    await act(async () => { finishSave({ success: false, error: 'Please try saving again.' }); });
    await waitFor(() => expect(save.disabled).toBe(false));
    await waitFor(() => expect(runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.length).toBeGreaterThan(previewCalls));
    expect(screen.getByText('Please try saving again.')).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('updates authoritative preview when switching to existing invoice data', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-flow" />);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(runAuthoritativeInvoiceTemplatePreviewMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await openExistingInvoiceSelect();
    fireEvent.click(await screen.findByText('INV-EX-001 · Acme Co.'));

    await waitFor(() => expect(getInvoiceForRenderingMock).toHaveBeenCalledWith('inv-existing-1'));
    await waitFor(() =>
      expect(runAuthoritativeInvoiceTemplatePreviewMock.mock.calls.at(-1)?.[0].invoiceData.invoiceNumber).toBe(
        'INV-EX-001'
      )
    );

    const renderedPreview = document.querySelector('[data-automation-id=\"invoice-designer-preview-render-output\"]');
    expect(renderedPreview?.textContent ?? '').toContain('INV-EX-001');
  });
});
