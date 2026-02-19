// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import { useInvoiceDesignerStore } from '../invoice-designer/state/designerStore';
import type { DesignerWorkspaceSnapshot } from '../invoice-designer/state/designerStore';
import { exportWorkspaceToInvoiceTemplateAst } from '../invoice-designer/ast/workspaceAst';

const pushMock = vi.fn();
const getInvoiceTemplateMock = vi.fn();
const saveInvoiceTemplateMock = vi.fn();
let searchParamsState = new URLSearchParams();
const featureFlagState: { enabled: boolean; loading: boolean; error: string | null } = {
  enabled: true,
  loading: false,
  error: null,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({
    toString: () => searchParamsState.toString(),
    get: (key: string) => searchParamsState.get(key),
  }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => featureFlagState,
}));

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  getInvoiceTemplate: (...args: unknown[]) => getInvoiceTemplateMock(...args),
  saveInvoiceTemplate: (...args: unknown[]) => saveInvoiceTemplateMock(...args),
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

vi.mock('../invoice-designer/DesignerVisualWorkspace', () => ({
  DesignerVisualWorkspace: ({
    visualWorkspaceTab,
    onVisualWorkspaceTabChange,
  }: {
    visualWorkspaceTab: 'design' | 'preview';
    onVisualWorkspaceTabChange: (tab: 'design' | 'preview') => void;
  }) => (
    <div data-testid="designer-visual-workspace">
      <span data-testid="designer-visual-workspace-tab">{visualWorkspaceTab}</span>
      <button type="button" onClick={() => onVisualWorkspaceTabChange('preview')}>
        Switch Preview
      </button>
    </div>
  ),
}));

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
        props: { name: 'Invoice Number', metadata: { bindingKey: 'invoice.number', format: 'text' } },
        children: [],
      },
    },
  };
};

const createWorkspaceWithFieldAndDynamicTable = (fieldId: string): DesignerWorkspaceSnapshot => {
  const base = createWorkspaceWithField(fieldId);
  const pageNode = Object.values(base.nodesById).find((node) => node.type === 'page');
  if (!pageNode) {
    return base;
  }
  const tableId = `${fieldId}-table`;

  return {
    ...base,
    nodesById: {
      ...base.nodesById,
      [pageNode.id]: {
        ...base.nodesById[pageNode.id],
        children: [...(base.nodesById[pageNode.id]?.children ?? []), tableId],
      },
      [tableId]: {
        id: tableId,
        type: 'dynamic-table',
        props: {
          name: 'Line Items',
          metadata: {
            collectionBindingKey: 'items',
            columns: [
              { id: 'col-desc', header: 'Description', key: 'item.description' },
              { id: 'col-total', header: 'Amount', key: 'item.total' },
            ],
          },
        },
        children: [],
      },
    },
  };
};

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

describe('InvoiceTemplateEditor preview workspace integration', () => {
  beforeEach(() => {
    installLocalStorageMock();
    searchParamsState = new URLSearchParams();
    featureFlagState.enabled = true;
    featureFlagState.loading = false;
    featureFlagState.error = null;
    pushMock.mockReset();
    getInvoiceTemplateMock.mockReset();
    saveInvoiceTemplateMock.mockReset();
    useInvoiceDesignerStore.getState().resetWorkspace();
    saveInvoiceTemplateMock.mockResolvedValue({ success: true });
    getInvoiceTemplateMock.mockResolvedValue({
      template_id: 'tpl-1',
      name: 'Template A',
      templateAst: {
        kind: 'invoice-template-ast',
        version: 1,
        layout: { id: 'root', type: 'document', children: [] },
      },
      isStandard: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('preserves nested visual workspace state when switching Visual -> Code -> Visual', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);

    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    fireEvent.click(screen.getByText('Switch Preview'));
    expect(screen.getByTestId('designer-visual-workspace-tab').textContent).toBe('preview');

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));

    expect(screen.getByTestId('designer-visual-workspace-tab').textContent).toBe('preview');
  });

  it('hydrates workspace from localStorage fallback', async () => {
    const workspace = createWorkspaceWithField('local-field');
    const storage = globalThis.localStorage as Storage | undefined;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(`alga.invoiceDesigner.workspace.${'tpl-local'}`, JSON.stringify(workspace));
    }
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-local',
      name: 'Template Local',
      templateAst: {
        kind: 'invoice-template-ast',
        version: 1,
        layout: { id: 'root', type: 'document', children: [] },
      },
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-local" />);

    await waitFor(() => {
      expect(useInvoiceDesignerStore.getState().nodes.some((node) => node.id === 'local-field')).toBe(true);
    });
  });

  it('hydrates workspace from persisted templateAst payload', async () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable('ast-field');
    const astPayload = exportWorkspaceToInvoiceTemplateAst(workspace);
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-ast',
      name: 'Template AST',
      templateAst: astPayload,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-ast" />);

    await waitFor(() => {
      expect(useInvoiceDesignerStore.getState().nodes.some((node) => node.type === 'dynamic-table')).toBe(true);
      expect(useInvoiceDesignerStore.getState().nodes.some((node) => node.id === 'ast-field')).toBe(true);
    });
  });

  it('keeps save payload behavior while preview sub-tab is active', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    fireEvent.click(screen.getByText('Switch Preview'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalled());
    const payload = saveInvoiceTemplateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: 'Template A',
      template_id: 'tpl-1',
    });
    expect(payload.templateAst).toMatchObject({
      kind: 'invoice-template-ast',
      version: 1,
    });
  });

  it('does not trigger save writes from preview interactions alone', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    fireEvent.click(screen.getByText('Switch Preview'));
    expect(saveInvoiceTemplateMock).not.toHaveBeenCalled();
  });

  it('allows preview workspace access for new templates before name validation', async () => {
    render(<InvoiceTemplateEditor templateId={null} />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    fireEvent.click(screen.getByText('Switch Preview'));
    expect(screen.getByTestId('designer-visual-workspace-tab').textContent).toBe('preview');
    expect(screen.queryByText('Template name is required.')).toBeNull();
  });

  it('keeps Code tab generated/read-only for GUI templates', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    expect(
      document.querySelector('[data-automation-id=\"invoice-template-editor-code-readonly-alert\"]')
    ).toBeTruthy();

    const editor = screen.getByTestId('monaco-mock');
    fireEvent.change(editor, { target: { value: '// manually edited source should be ignored' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalled());
    const payload = saveInvoiceTemplateMock.mock.calls.at(-1)?.[0];
    expect(payload.templateAst).toMatchObject({
      kind: 'invoice-template-ast',
      version: 1,
    });
  });

  it('enables visual designer in local QA via forceInvoiceDesigner=1 when feature flag is off', async () => {
    featureFlagState.enabled = false;
    searchParamsState = new URLSearchParams('forceInvoiceDesigner=1');

    render(<InvoiceTemplateEditor templateId="tpl-1" />);

    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    expect(
      document.querySelector('[data-automation-id=\"invoice-template-editor-local-designer-override\"]')
    ).toBeTruthy();
  });

  it('keeps production behavior when feature flag is off and no override is set', async () => {
    featureFlagState.enabled = false;

    render(<InvoiceTemplateEditor templateId="tpl-1" />);

    await waitFor(() => expect(screen.getByTestId('monaco-mock')).toBeTruthy());
    expect(screen.queryByTestId('designer-visual-workspace')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Visual' })).toBeNull();
  });

  it('keeps generated source synchronized with GUI model while switching Visual and Code', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    await waitFor(() => expect(getInvoiceTemplateMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    act(() => {
      useInvoiceDesignerStore.getState().loadWorkspace(createWorkspaceWithField('field-sync'));
    });

    await waitFor(() => {
      const editor = screen.getByTestId('monaco-mock') as HTMLTextAreaElement;
      expect(editor.value).toContain('field-sync');
    });

    act(() => {
      const store = useInvoiceDesignerStore.getState();
      store.setNodeProp('field-sync', 'metadata.bindingKey', 'customer.name', false);
      store.setNodeProp('field-sync', 'metadata.format', 'text', true);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    await waitFor(() =>
      expect((screen.getByTestId('monaco-mock') as HTMLTextAreaElement).value).toContain('customer.name')
    );
  });
});
