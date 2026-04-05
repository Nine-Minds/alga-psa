// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import { useInvoiceDesignerStore } from '../invoice-designer/state/designerStore';
import type { DesignerWorkspaceSnapshot } from '../invoice-designer/state/designerStore';
import { exportWorkspaceToTemplateAst } from '../invoice-designer/ast/workspaceAst';

const pushMock = vi.fn();
const getInvoiceTemplateMock = vi.fn();
const saveInvoiceTemplateMock = vi.fn();
let searchParamsState = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => ({
    toString: () => searchParamsState.toString(),
    get: (key: string) => searchParamsState.get(key),
  }),
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
    visualWorkspaceTab: 'design' | 'transforms' | 'preview';
    onVisualWorkspaceTabChange: (tab: 'design' | 'transforms' | 'preview') => void;
  }) => (
    <div data-testid="designer-visual-workspace">
      <span data-testid="designer-visual-workspace-tab">{visualWorkspaceTab}</span>
      <button type="button" onClick={() => onVisualWorkspaceTabChange('preview')}>
        Switch Preview
      </button>
      <button type="button" onClick={() => onVisualWorkspaceTabChange('transforms')}>
        Switch Transforms
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

const buildTransformedTemplateAst = () => {
  const workspace = createWorkspaceWithFieldAndDynamicTable('transforms-field');
  const pageNode = Object.values(workspace.nodesById).find((node) => node.type === 'page');
  const pageId = pageNode?.id;
  if (pageId) {
    workspace.nodesById[pageId] = {
      ...workspace.nodesById[pageId],
      children: [...workspace.nodesById[pageId].children, 'grouped-table'],
    };
    workspace.nodesById['grouped-table'] = {
      id: 'grouped-table',
      type: 'dynamic-table',
      props: {
        name: 'Grouped Line Items',
        metadata: {
          collectionBindingKey: 'lineItems.grouped',
          columns: [
            { id: 'col-key', header: 'Category', key: 'item.key' },
            { id: 'col-total', header: 'Amount', key: 'item.aggregates.sumTotal' },
          ],
        },
      },
      children: [],
    };
  }

  workspace.transforms = {
    sourceBindingId: 'lineItems',
    outputBindingId: 'lineItems.grouped',
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
    ] as any,
  };

  return exportWorkspaceToTemplateAst(workspace);
};

const findLayoutNodeById = (node: any, id: string): any | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (node.id === id) {
    return node;
  }
  if (!Array.isArray(node.children)) {
    return null;
  }
  for (const child of node.children) {
    const match = findLayoutNodeById(child, id);
    if (match) {
      return match;
    }
  }
  return null;
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

const transformedWorkspaceState = {
  sourceBindingId: 'collection.items',
  outputBindingId: 'transformed.items',
  operations: [
    {
      id: 'filter-positive',
      type: 'filter' as const,
      predicate: {
        type: 'comparison' as const,
        path: 'total',
        op: 'gt' as const,
        value: 0,
      },
    },
    {
      id: 'group-category',
      type: 'group' as const,
      key: 'category',
    },
    {
      id: 'aggregate-total',
      type: 'aggregate' as const,
      aggregations: [{ id: 'sumTotal', op: 'sum' as const, path: 'total' }],
    },
  ],
};

describe('InvoiceTemplateEditor preview workspace integration', () => {
  beforeEach(() => {
    installLocalStorageMock();
    searchParamsState = new URLSearchParams();
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

  it('renders the Transforms sub-tab and preserves it across Visual -> Code -> Visual switches', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);

    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    fireEvent.click(screen.getByText('Switch Transforms'));
    expect(screen.getByTestId('designer-visual-workspace-tab').textContent).toBe('transforms');

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));

    expect(screen.getByTestId('designer-visual-workspace-tab').textContent).toBe('transforms');
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
      templateAst: null,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-local" />);

    await waitFor(() => {
      expect(useInvoiceDesignerStore.getState().nodes.some((node) => node.id === 'local-field')).toBe(true);
    });
  });

  it('hydrates workspace from persisted templateAst payload', async () => {
    const workspace = createWorkspaceWithFieldAndDynamicTable('ast-field');
    const astPayload = exportWorkspaceToTemplateAst(workspace);
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

  it('persists edited field designer placeholders through save and reopen', async () => {
    const workspace = createWorkspaceWithField('placeholder-field');
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-placeholder',
      name: 'Template Placeholder',
      templateAst: exportWorkspaceToTemplateAst(workspace as any),
      isStandard: false,
    });

    const rendered = render(<InvoiceTemplateEditor templateId="tpl-placeholder" />);

    await waitFor(() => {
      const fieldNode = useInvoiceDesignerStore.getState().nodesById['placeholder-field'];
      expect(fieldNode).toBeTruthy();
      expect((fieldNode?.props as any)?.metadata?.placeholder).toBe('Invoice Number');
    });

    act(() => {
      useInvoiceDesignerStore.getState().setNodeProp(
        'placeholder-field',
        'metadata.placeholder',
        'Invoice Reference',
        true
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalledTimes(1));

    const savedAst = saveInvoiceTemplateMock.mock.calls[0]?.[0]?.templateAst;
    const savedField = findLayoutNodeById(savedAst.layout, 'placeholder-field');
    expect(savedField?.type).toBe('field');
    if (!savedField || savedField.type !== 'field') return;
    expect(savedField.placeholder).toBe('Invoice Reference');

    rendered.unmount();
    useInvoiceDesignerStore.getState().resetWorkspace();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-placeholder',
      name: 'Template Placeholder',
      templateAst: savedAst,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-placeholder" />);

    await waitFor(() => {
      const fieldNode = useInvoiceDesignerStore.getState().nodesById['placeholder-field'];
      expect((fieldNode?.props as any)?.metadata?.placeholder).toBe('Invoice Reference');
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
    expect(payload.templateAst.transforms).toBeUndefined();
  });

  it('persists authored transform workspace state into the save payload', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    await waitFor(() => expect(getInvoiceTemplateMock).toHaveBeenCalled());

    act(() => {
      useInvoiceDesignerStore.getState().setTransforms(transformedWorkspaceState);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalled());

    const payload = saveInvoiceTemplateMock.mock.calls.at(-1)?.[0];
    expect(payload.templateAst.transforms).toMatchObject({
      sourceBindingId: 'collection.items',
      outputBindingId: 'transformed.items',
      operations: [
        { id: 'filter-positive', type: 'filter' },
        { id: 'group-category', type: 'group' },
        { id: 'aggregate-total', type: 'aggregate' },
      ],
    });
  });

  it('renders the authored transforms block in the read-only code tab', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    await waitFor(() => expect(getInvoiceTemplateMock).toHaveBeenCalled());

    act(() => {
      useInvoiceDesignerStore.getState().setTransforms(transformedWorkspaceState);
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));

    await waitFor(() => {
      const editor = screen.getByTestId('monaco-mock') as HTMLTextAreaElement;
      const parsed = JSON.parse(editor.value);
      expect(parsed.transforms).toMatchObject({
        sourceBindingId: 'collection.items',
        outputBindingId: 'transformed.items',
        operations: [
          { id: 'filter-positive', type: 'filter' },
          { id: 'group-category', type: 'group' },
          { id: 'aggregate-total', type: 'aggregate' },
        ],
      });
    });
  });

  it('keeps the read-only code tab valid JSON when no transforms are authored', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));

    const editor = screen.getByTestId('monaco-mock') as HTMLTextAreaElement;
    const parsed = JSON.parse(editor.value);
    expect(parsed.kind).toBe('invoice-template-ast');
    expect(parsed.version).toBe(1);
    expect(parsed.transforms).toBeUndefined();
  });

  it('preserves authored transforms after save and reopen without edits', async () => {
    const firstRender = render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    await waitFor(() => expect(getInvoiceTemplateMock).toHaveBeenCalled());

    act(() => {
      useInvoiceDesignerStore.getState().setTransforms(transformedWorkspaceState);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalled());

    const savedPayload = saveInvoiceTemplateMock.mock.calls.at(-1)?.[0];
    expect(savedPayload.templateAst.transforms).toMatchObject(transformedWorkspaceState);

    firstRender.unmount();
    useInvoiceDesignerStore.getState().resetWorkspace();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-1',
      name: 'Template A',
      templateAst: savedPayload.templateAst,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-1" />);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms).toMatchObject(transformedWorkspaceState)
    );
  });

  it('preserves reordered transforms after save and reopen', async () => {
    const reorderedTransforms = {
      sourceBindingId: 'collection.items',
      outputBindingId: 'transformed.items',
      operations: [
        {
          id: 'sort-total',
          type: 'sort' as const,
          keys: [{ path: 'total', direction: 'desc' as const }],
        },
        {
          id: 'group-category',
          type: 'group' as const,
          key: 'category',
        },
        {
          id: 'aggregate-total',
          type: 'aggregate' as const,
          aggregations: [{ id: 'sumTotal', op: 'sum' as const, path: 'total' }],
        },
      ],
    };

    const firstRender = render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    await waitFor(() => expect(getInvoiceTemplateMock).toHaveBeenCalled());

    act(() => {
      useInvoiceDesignerStore.getState().setTransforms(reorderedTransforms);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalled());

    const savedPayload = saveInvoiceTemplateMock.mock.calls.at(-1)?.[0];
    expect(savedPayload.templateAst.transforms.operations.map((operation: { id: string }) => operation.id)).toEqual([
      'sort-total',
      'group-category',
      'aggregate-total',
    ]);

    firstRender.unmount();
    useInvoiceDesignerStore.getState().resetWorkspace();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-1',
      name: 'Template A',
      templateAst: savedPayload.templateAst,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-1" />);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id)).toEqual([
        'sort-total',
        'group-category',
        'aggregate-total',
      ])
    );
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

  it('shows the generated transforms block in the read-only code tab when transforms are authored', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());
    await waitFor(() => expect(getInvoiceTemplateMock).toHaveBeenCalled());

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
        ] as any,
      });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));

    await waitFor(() => {
      const editor = screen.getByTestId('monaco-mock') as HTMLTextAreaElement;
      expect(editor.value).toContain('"transforms"');
      expect(editor.value).toContain('"outputBindingId": "lineItems.grouped"');
      expect(editor.value).toContain('"aggregate-total"');
    });
  });

  it('keeps the generated code tab as valid AST JSON when no transforms are authored', async () => {
    render(<InvoiceTemplateEditor templateId="tpl-1" />);
    await waitFor(() => expect(screen.getByTestId('designer-visual-workspace')).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));

    const editor = await screen.findByTestId('monaco-mock');
    const generatedAst = JSON.parse((editor as HTMLTextAreaElement).value);
    expect(generatedAst.kind).toBe('invoice-template-ast');
    expect(generatedAst.version).toBe(1);
    expect(generatedAst.transforms).toBeUndefined();
  });

  it('round-trips unchanged transforms through save and reopen without losing configuration', async () => {
    const transformedAst = buildTransformedTemplateAst();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-roundtrip',
      name: 'Template Roundtrip',
      templateAst: transformedAst,
      isStandard: false,
    });

    const rendered = render(<InvoiceTemplateEditor templateId="tpl-roundtrip" />);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id)).toEqual([
        'filter-positive',
        'sort-total',
        'group-category',
        'aggregate-total',
      ])
    );
    expect(
      (
        useInvoiceDesignerStore.getState().nodesById['grouped-table']?.props as
          | { metadata?: { collectionBindingKey?: string } }
          | undefined
      )?.metadata?.collectionBindingKey
    ).toBe('lineItems.grouped');

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalledTimes(1));

    const savedAst = saveInvoiceTemplateMock.mock.calls[0]?.[0]?.templateAst;
    expect(savedAst.transforms).toEqual(transformedAst.transforms);

    rendered.unmount();
    useInvoiceDesignerStore.getState().resetWorkspace();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-roundtrip',
      name: 'Template Roundtrip',
      templateAst: savedAst,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-roundtrip" />);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id)).toEqual([
        'filter-positive',
        'sort-total',
        'group-category',
        'aggregate-total',
      ])
    );
    expect(useInvoiceDesignerStore.getState().transforms.outputBindingId).toBe('lineItems.grouped');
    expect(
      (
        useInvoiceDesignerStore.getState().nodesById['grouped-table']?.props as
          | { metadata?: { collectionBindingKey?: string } }
          | undefined
      )?.metadata?.collectionBindingKey
    ).toBe('lineItems.grouped');
  });

  it('persists edited grouped-table aggregate column bindings through save and reopen', async () => {
    const transformedAst = JSON.parse(JSON.stringify(buildTransformedTemplateAst()));
    const groupedTable = findLayoutNodeById(transformedAst.layout, 'grouped-table');
    expect(groupedTable?.type).toBe('dynamic-table');
    if (!groupedTable || groupedTable.type !== 'dynamic-table') return;
    groupedTable.columns = groupedTable.columns.map((column: { id: string; value: unknown }) =>
      column.id === 'col-total'
        ? {
            ...column,
            value: { type: 'path', path: 'total' },
          }
        : column
    );

    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-column-roundtrip',
      name: 'Template Column Roundtrip',
      templateAst: transformedAst,
      isStandard: false,
    });

    const rendered = render(<InvoiceTemplateEditor templateId="tpl-column-roundtrip" />);

    await waitFor(() => {
      const groupedTableNode = useInvoiceDesignerStore.getState().nodesById['grouped-table'];
      expect(groupedTableNode).toBeTruthy();
      expect((groupedTableNode?.props as any)?.metadata?.columns?.find((column: { id: string }) => column.id === 'col-total')?.key).toBe('item.total');
    });

    act(() => {
      useInvoiceDesignerStore.getState().setNodeProp(
        'grouped-table',
        'metadata.columns.1.key',
        'item.aggregates.sumTotal',
        true
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalledTimes(1));

    const savedAst = saveInvoiceTemplateMock.mock.calls[0]?.[0]?.templateAst;
    const savedGroupedTable = findLayoutNodeById(savedAst.layout, 'grouped-table');
    expect(savedGroupedTable?.type).toBe('dynamic-table');
    if (!savedGroupedTable || savedGroupedTable.type !== 'dynamic-table') return;
    expect(savedGroupedTable.columns.find((column: { id: string }) => column.id === 'col-total')?.value).toEqual({
      type: 'path',
      path: 'aggregates.sumTotal',
    });

    rendered.unmount();
    useInvoiceDesignerStore.getState().resetWorkspace();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-column-roundtrip',
      name: 'Template Column Roundtrip',
      templateAst: savedAst,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-column-roundtrip" />);

    await waitFor(() => {
      const groupedTableNode = useInvoiceDesignerStore.getState().nodesById['grouped-table'];
      expect((groupedTableNode?.props as any)?.metadata?.columns?.find((column: { id: string }) => column.id === 'col-total')?.key).toBe(
        'item.aggregates.sumTotal'
      );
    });
  });

  it('preserves reordered transform order through save and reopen', async () => {
    const transformedAst = buildTransformedTemplateAst();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-reorder',
      name: 'Template Reorder',
      templateAst: transformedAst,
      isStandard: false,
    });

    const rendered = render(<InvoiceTemplateEditor templateId="tpl-reorder" />);
    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id)).toEqual([
        'filter-positive',
        'sort-total',
        'group-category',
        'aggregate-total',
      ])
    );

    act(() => {
      const current = useInvoiceDesignerStore.getState().transforms;
      useInvoiceDesignerStore.getState().setTransforms({
        ...current,
        operations: [current.operations[1]!, current.operations[0]!, current.operations[2]!, current.operations[3]!],
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(saveInvoiceTemplateMock).toHaveBeenCalledTimes(1));

    const savedAst = saveInvoiceTemplateMock.mock.calls[0]?.[0]?.templateAst;
    expect(savedAst.transforms.operations.map((operation: any) => operation.id)).toEqual([
      'sort-total',
      'filter-positive',
      'group-category',
      'aggregate-total',
    ]);

    rendered.unmount();
    useInvoiceDesignerStore.getState().resetWorkspace();
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-reorder',
      name: 'Template Reorder',
      templateAst: savedAst,
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-reorder" />);

    await waitFor(() =>
      expect(useInvoiceDesignerStore.getState().transforms.operations.map((operation) => operation.id)).toEqual([
        'sort-total',
        'filter-positive',
        'group-category',
        'aggregate-total',
      ])
    );
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
