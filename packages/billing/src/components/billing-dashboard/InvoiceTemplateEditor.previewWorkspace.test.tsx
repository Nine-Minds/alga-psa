// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import { useInvoiceDesignerStore } from '../invoice-designer/state/designerStore';
import * as persistenceUtils from '../invoice-designer/utils/persistence';
import type { DesignerWorkspaceSnapshot } from '../invoice-designer/state/designerStore';

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
  const documentNode = base.nodes.find((node) => node.type === 'document');
  const pageNode = base.nodes.find((node) => node.type === 'page');
  if (!documentNode || !pageNode) {
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
    nodes: base.nodes.map((node) => {
      if (node.id !== pageNode.id) {
        return node;
      }
      return {
        ...node,
        childIds: [...node.childIds, fieldId],
      };
    }).concat(fieldNode),
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
    Object.defineProperty(window, 'atob', { value: undefined, configurable: true });
    Object.defineProperty(window, 'btoa', { value: undefined, configurable: true });
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
      assemblyScriptSource: '// template source',
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

  it('hydrates workspace from source-embedded designer state', async () => {
    const workspace = createWorkspaceWithField('embedded-field');
    const extractSpy = vi
      .spyOn(persistenceUtils, 'extractInvoiceDesignerStateFromSource')
      .mockReturnValue({ version: 1, workspace } as any);
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-embedded',
      name: 'Template Embedded',
      assemblyScriptSource: '// source',
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-embedded" />);

    await waitFor(() => {
      expect(useInvoiceDesignerStore.getState().nodes.some((node) => node.id === 'embedded-field')).toBe(true);
    });
    extractSpy.mockRestore();
  });

  it('hydrates workspace from localStorage fallback when source has no embedded state', async () => {
    const workspace = createWorkspaceWithField('local-field');
    const storage = globalThis.localStorage as Storage | undefined;
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(
        persistenceUtils.getInvoiceDesignerLocalStorageKey('tpl-local'),
        JSON.stringify({ version: 1, workspace })
      );
    }
    getInvoiceTemplateMock.mockResolvedValueOnce({
      template_id: 'tpl-local',
      name: 'Template Local',
      assemblyScriptSource: '// plain source',
      isStandard: false,
    });

    render(<InvoiceTemplateEditor templateId="tpl-local" />);

    await waitFor(() => {
      expect(useInvoiceDesignerStore.getState().nodes.some((node) => node.id === 'local-field')).toBe(true);
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
    expect(typeof payload.assemblyScriptSource).toBe('string');
    expect(payload.assemblyScriptSource).toContain('export function generateLayout');
    expect(payload.assemblyScriptSource).toContain('ALGA_INVOICE_DESIGNER_STATE_V1');
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
    expect(payload.assemblyScriptSource).toContain('export function generateLayout');
    expect(payload.assemblyScriptSource).not.toContain('// manually edited source should be ignored');
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
      useInvoiceDesignerStore.getState().updateNodeMetadata('field-sync', {
        bindingKey: 'customer.name',
        format: 'text',
      });
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Code' }));
    await waitFor(() =>
      expect((screen.getByTestId('monaco-mock') as HTMLTextAreaElement).value).toContain('customer.name')
    );
  });
});
