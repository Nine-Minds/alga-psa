// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runAuthoritativeTemplatePreviewMock = vi.hoisted(() => vi.fn());
const listExistingDocumentsForPreviewMock = vi.hoisted(() => vi.fn());

vi.mock('@monaco-editor/react', () => ({
  Editor: () => <div data-automation-id="monaco-editor-mock" />,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../actions/documentTemplateActions', () => ({
  runAuthoritativeTemplatePreview: (...args: unknown[]) => runAuthoritativeTemplatePreviewMock(...args),
  listExistingDocumentsForPreview: (...args: unknown[]) => listExistingDocumentsForPreviewMock(...args),
  saveDocumentTemplate: vi.fn(),
}));

vi.mock('../../invoice-designer/DesignerShell', () => ({
  DesignerShell: () => <div data-automation-id="designer-shell-mock">Designer Shell</div>,
}));

vi.mock('../../invoice-designer/transforms/TransformsWorkspace', () => ({
  default: () => <div data-automation-id="transforms-workspace-mock">Transforms</div>,
}));

const i18nStubs = vi.hoisted(() => ({
  formatters: { formatDate: (value: string) => value },
  translation: {
    t: (key: string, options?: { defaultValue?: string; type?: string }) => {
      const template = options?.defaultValue ?? key;
      return options?.type ? template.replace('{{type}}', options.type) : template;
    },
    i18n: { language: 'en' },
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => i18nStubs.formatters,
  useTranslation: () => i18nStubs.translation,
}));

import DocumentTemplateEditor from './DocumentTemplateEditor';
import { getDocumentTypeStandardAst } from '../../../lib/document-templates/registry';

const renderEditor = (documentType: string = 'sales-order') =>
  render(
    <DocumentTemplateEditor
      documentType={documentType}
      template={{ name: 'Order Confirmation', version: 1, templateAst: getDocumentTypeStandardAst(documentType as any) }}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

const openPreviewTab = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Existing' })).toBeTruthy());
};

const openExistingDocumentSelect = async () => {
  const trigger = await waitFor(() => {
    const element = document.querySelector(
      '[data-automation-type="async-searchable-select"] button[role="combobox"]'
    );
    if (!element) throw new Error('Existing-document select is not rendered');
    return element as HTMLElement;
  });
  fireEvent.click(trigger);
};

describe('DocumentTemplateEditor existing-document preview', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    runAuthoritativeTemplatePreviewMock.mockReset();
    listExistingDocumentsForPreviewMock.mockReset();
    runAuthoritativeTemplatePreviewMock.mockResolvedValue({ html: '<html><body>Preview</body></html>' });
    listExistingDocumentsForPreviewMock.mockResolvedValue({
      options: [
        { value: 'so-1', label: 'SO-00100 · Acme Corp' },
        { value: 'so-2', label: 'SO-00101 · Globex' },
      ],
      total: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('previews the sample by default and offers an existing-document source', async () => {
    renderEditor();
    await openPreviewTab();

    await waitFor(() => expect(runAuthoritativeTemplatePreviewMock).toHaveBeenCalled());
    expect(runAuthoritativeTemplatePreviewMock.mock.calls.at(-1)?.[3]).toBeNull();
    expect(screen.getByRole('button', { name: 'Sample' })).toBeTruthy();
  });

  it('renders the layout against a selected existing sales order', async () => {
    renderEditor('packing-slip');
    await openPreviewTab();
    await waitFor(() => expect(runAuthoritativeTemplatePreviewMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    // Nothing is re-rendered until an order is chosen.
    expect(screen.getAllByText('Select a sales order to preview data-bound output.').length).toBeGreaterThan(0);
    const callsBeforeSelection = runAuthoritativeTemplatePreviewMock.mock.calls.length;

    await openExistingDocumentSelect();
    fireEvent.click(await screen.findByText('SO-00100 · Acme Corp'));

    await waitFor(() =>
      expect(runAuthoritativeTemplatePreviewMock.mock.calls.length).toBeGreaterThan(callsBeforeSelection)
    );
    const lastCall = runAuthoritativeTemplatePreviewMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe('packing-slip');
    expect(lastCall?.[3]).toBe('so-1');
    expect(listExistingDocumentsForPreviewMock).toHaveBeenCalledWith(
      'packing-slip',
      expect.objectContaining({ page: 1 })
    );
  });
});
