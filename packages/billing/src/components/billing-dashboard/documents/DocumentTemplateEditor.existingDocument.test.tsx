// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runAuthoritativeTemplatePreviewMock = vi.hoisted(() => vi.fn());
const listExistingDocumentsForPreviewMock = vi.hoisted(() => vi.fn());
const saveDocumentTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('@monaco-editor/react', () => ({
  Editor: () => <div data-automation-id="monaco-editor-mock" />,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../actions/documentTemplateActions', () => ({
  runAuthoritativeTemplatePreview: (...args: unknown[]) => runAuthoritativeTemplatePreviewMock(...args),
  listExistingDocumentsForPreview: (...args: unknown[]) => listExistingDocumentsForPreviewMock(...args),
  saveDocumentTemplate: (...args: unknown[]) => saveDocumentTemplateMock(...args),
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
import {
  getStandardLabelTemplateAstByCode,
  STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_A4_CODE,
  STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE,
  STANDARD_LABEL_TICKET_WORK_TAG_CODE,
} from '../../../lib/label-template-ast/standardTemplates';

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
    saveDocumentTemplateMock.mockReset();
    saveDocumentTemplateMock.mockResolvedValue({ success: true, template_id: 'saved-template' });
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

  it('preserves worksheet metadata through preview and save, including dependent visibility', async () => {
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_CODE)!;
    ast.metadata!.labelSettings!.hiddenFields = ['serialSuffix', 'detail'];
    const onSave = vi.fn();
    render(
      <DocumentTemplateEditor
        documentType="work-tag"
        template={{ name: 'Customer worksheet', version: 1, templateAst: ast }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    // The Letter page the template declares makes it a worksheet, so the worksheet-only fields render.
    const serial = await waitFor(() => {
      const element = screen.getByLabelText('Full asset serial number') as HTMLInputElement;
      expect(element.disabled).toBe(true);
      return element;
    });
    expect(serial.checked).toBe(false);
    const description = screen.getByLabelText('Ticket description') as HTMLInputElement;
    expect(description.checked).toBe(false);
    expect(description.disabled).toBe(true);

    await openPreviewTab();
    await waitFor(() => expect(runAuthoritativeTemplatePreviewMock).toHaveBeenCalled());
    const previewAst = runAuthoritativeTemplatePreviewMock.mock.calls.at(-1)?.[1];
    expect(previewAst.metadata).toMatchObject({
      labelClass: 'ticket-work-tag',
      labelSettings: { hiddenFields: ['serialSuffix', 'detail'] },
      printSettings: { customPageSize: { width: 8.5, height: 11, unit: 'in' } },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Layout' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('saved-template'));
    expect(saveDocumentTemplateMock.mock.calls.at(-1)?.[1].templateAst.metadata).toMatchObject(previewAst.metadata);
  });

  it('keeps worksheet-only fields off a tag-sized template and carries field visibility through export', async () => {
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_WORK_TAG_CODE)!;
    render(
      <DocumentTemplateEditor
        documentType="work-tag"
        template={{ name: 'Custom tag', version: 1, templateAst: ast }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // A 4 x 2 in page is a tag, so the worksheet-only fields never appear.
    expect(screen.queryByLabelText('Full asset serial number')).toBeNull();
    await openPreviewTab();
    await waitFor(() => expect(runAuthoritativeTemplatePreviewMock).toHaveBeenCalled());
    expect(runAuthoritativeTemplatePreviewMock.mock.calls.at(-1)?.[1].metadata.labelSettings).toMatchObject({
      hiddenFields: [],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Layout' }));
    await waitFor(() => expect(saveDocumentTemplateMock).toHaveBeenCalled());
    expect(saveDocumentTemplateMock.mock.calls.at(-1)?.[1].templateAst.metadata.labelSettings).toEqual({
      hiddenFields: [],
    });
  });

  it('shows worksheet-only fields when the author sets a worksheet page size', async () => {
    const ast = getStandardLabelTemplateAstByCode(STANDARD_LABEL_TICKET_CUSTOMER_WORKSHEET_A4_CODE)!;
    render(
      <DocumentTemplateEditor
        documentType="work-tag"
        template={{ name: 'A4 worksheet', version: 1, templateAst: ast }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The A4 page the template declares is worksheet paper: the fields render and can be toggled.
    await waitFor(() => expect(screen.getByLabelText('Full asset serial number')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Full asset serial number'));
    await openPreviewTab();
    await waitFor(() => expect(runAuthoritativeTemplatePreviewMock).toHaveBeenCalled());
    expect(runAuthoritativeTemplatePreviewMock.mock.calls.at(-1)?.[1].metadata.labelSettings).toMatchObject({
      hiddenFields: ['assetSerialNumber'],
    });
  });
});
