// @vitest-environment jsdom
/**
 * The document layout editor's compact header row: the document type in the back label, the name,
 * version and saved status on the row, and the label-only settings behind one button.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveDocumentTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('@monaco-editor/react', () => ({
  Editor: () => <div data-automation-id="monaco-editor-mock" />,
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../actions/documentTemplateActions', () => ({
  runAuthoritativeTemplatePreview: vi.fn().mockResolvedValue({ html: '<html><body>Preview</body></html>' }),
  listExistingDocumentsForPreview: vi.fn().mockResolvedValue({ options: [], total: 0 }),
  saveDocumentTemplate: (...args: unknown[]) => saveDocumentTemplateMock(...args),
}));

vi.mock('../../invoice-designer/DesignerShell', () => ({
  DesignerShell: () => <div data-automation-id="designer-shell-mock">Designer Shell</div>,
}));

vi.mock('../../invoice-designer/transforms/TransformsWorkspace', () => ({
  default: () => <div data-automation-id="transforms-workspace-mock">Transforms</div>,
}));

const i18nStubs = vi.hoisted(() => ({
  formatters: { formatDate: (value: string) => `on ${value}` },
  translation: {
    t: (key: string, options?: Record<string, unknown>) => {
      const template = (options?.defaultValue as string) ?? key;
      return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
        options && options[name] !== undefined ? String(options[name]) : match
      );
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

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function renderEditor({
  documentType = 'sales-order',
  template = {},
  onCancel = vi.fn(),
  onSave = vi.fn(),
}: {
  documentType?: string;
  template?: Record<string, unknown>;
  onCancel?: () => void;
  onSave?: (id: string) => void;
} = {}) {
  const result = render(
    <DocumentTemplateEditor
      documentType={documentType}
      template={{
        template_id: 'template-1',
        name: 'Order Confirmation',
        version: 2,
        created_at: '2026-11-01T09:00:00.000Z',
        updated_at: '2026-11-18T09:00:00.000Z',
        templateAst: getDocumentTypeStandardAst(documentType as any),
        ...template,
      }}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
  return { ...result, onCancel, onSave };
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  // Radix Select needs these; jsdom ships neither.
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(() => false),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  saveDocumentTemplateMock.mockResolvedValue({ success: true, template_id: 'template-1' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('document layout editor header row', () => {
  it('drops the details card, the description and the footer', () => {
    const { container } = renderEditor();

    expect(container.textContent).not.toContain('Layout Details');
    expect(container.textContent).not.toContain('using the visual editor');
    expect(container.textContent).not.toContain('Last Updated');
    expect(container.textContent).not.toContain('Created:');
  });

  it('puts the header row and the Visual / Code tabs in one card', () => {
    const { container } = renderEditor();

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('card-elevated');
    expect(card.contains(byId('document-template-editor-back'))).toBe(true);
    expect(card.contains(byId('document-template-name-input'))).toBe(true);
    expect(card.querySelector('[data-automation-id="document-template-editor-visual-tab"]')).not.toBeNull();
    expect(card.querySelector('[data-automation-id="document-template-editor-code-tab"]')).not.toBeNull();
  });

  it('names the document type in the back navigation and cancels with it', async () => {
    const { onCancel } = renderEditor({ documentType: 'sales-order' });

    expect(byId('document-template-editor-back').textContent).toContain('Back to Sales Order Layouts');

    await userEvent.click(byId('document-template-editor-back'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('titles an existing layout with its name and follows the name as it is typed', async () => {
    const { container } = renderEditor();

    expect(container.textContent).toContain('Edit Layout: Order Confirmation');

    const name = byId<HTMLInputElement>('document-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed layout');

    expect(container.textContent).toContain('Edit Layout: Renamed layout');
    expect(container.querySelector('h2')!.className).toContain('truncate');
  });

  it('titles a new layout with its document type', () => {
    const { container } = renderEditor({ template: { template_id: undefined, name: '' } });

    expect(container.textContent).toContain('New Sales Order Layout');
  });

  it('keeps the name input in the header with its type-specific placeholder', async () => {
    renderEditor();

    const name = byId<HTMLInputElement>('document-template-name-input');
    expect(name.value).toBe('Order Confirmation');
    expect(name.placeholder).toBe('Sales Order Template');

    await userEvent.type(name, '!');
    expect(byId<HTMLInputElement>('document-template-name-input').value).toBe('Order Confirmation!');
  });

  it('clamps the version to whole numbers of at least 1', () => {
    renderEditor();

    const version = byId<HTMLInputElement>('document-template-version-input');
    expect(version.value).toBe('2');

    for (const typed of ['0', '-3', 'abc']) {
      fireEvent.change(version, { target: { value: typed } });
      expect(byId<HTMLInputElement>('document-template-version-input').value).toBe('1');
    }
  });

  it('offers Label settings only for work-tag layouts', () => {
    renderEditor({ documentType: 'work-tag' });
    expect(byId('document-template-label-settings')).not.toBeNull();

    cleanup();
    renderEditor({ documentType: 'sales-order' });
    expect(byId('document-template-label-settings')).toBeNull();
    expect(byId('document-template-label-class-select')).toBeNull();
    expect(byId('document-template-label-field-title')).toBeNull();
  });

  it('shows the label class, the field checkboxes and their hint in the popover', async () => {
    const { container } = renderEditor({ documentType: 'work-tag' });

    await userEvent.click(byId('document-template-label-settings'));

    await waitFor(() => expect(byId('document-template-label-class-select')).not.toBeNull());
    expect(byId('document-template-label-field-title')).not.toBeNull();
    expect(byId('document-template-label-field-clientName')).not.toBeNull();
    expect(document.body.textContent).toContain('The record link (QR code) and the identifier are always shown.');
    expect(container).toBeTruthy();
  });

  it('stays open while its own controls are used', async () => {
    renderEditor({ documentType: 'work-tag' });
    await userEvent.click(byId('document-template-label-settings'));
    await waitFor(() => expect(byId('document-template-label-field-title')).not.toBeNull());

    await userEvent.click(byId('document-template-label-field-title'));
    expect(byId<HTMLInputElement>('document-template-label-field-title').checked).toBe(false);

    // Picking a label class is not an interaction "outside" the popover.
    fireEvent.click(byId('document-template-label-class-select'));
    fireEvent.click(await screen.findByText('Asset label'));

    expect(byId('document-template-label-field-title')).not.toBeNull();
    expect(byId('document-template-label-class-select').textContent).toContain('Asset label');
  });

  it('remembers unticked fields while the popover is closed', async () => {
    renderEditor({ documentType: 'work-tag' });
    await userEvent.click(byId('document-template-label-settings'));
    await waitFor(() => expect(byId('document-template-label-field-detail')).not.toBeNull());

    await userEvent.click(byId('document-template-label-field-detail'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(byId('document-template-label-field-detail')).toBeNull());

    await userEvent.click(byId('document-template-label-settings'));
    await waitFor(() => expect(byId('document-template-label-field-detail')).not.toBeNull());
    expect(byId<HTMLInputElement>('document-template-label-field-detail').checked).toBe(false);
  });

  it('saves the chosen label class and hidden fields with the layout', async () => {
    renderEditor({ documentType: 'work-tag' });
    await userEvent.click(byId('document-template-label-settings'));
    await waitFor(() => expect(byId('document-template-label-field-detail')).not.toBeNull());

    await userEvent.click(byId('document-template-label-field-detail'));
    fireEvent.click(byId('document-template-label-class-select'));
    fireEvent.click(await screen.findByText('Asset label'));

    await userEvent.click(byId('document-template-editor-save'));

    await waitFor(() => expect(saveDocumentTemplateMock).toHaveBeenCalled());
    const [, payload] = saveDocumentTemplateMock.mock.calls[0] as [string, any];
    expect(payload.templateAst.metadata.labelClass).toBe('asset-identity');
    expect(payload.templateAst.metadata.labelSettings.hiddenFields).toEqual(['detail']);
  });

  it('shows the saved time, the created date as its tooltip, and announces changes politely', () => {
    renderEditor();

    const status = byId('document-template-save-status');
    expect(status.textContent).toBe('Saved on 2026-11-18T09:00:00.000Z');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('title')).toBe('Created on 2026-11-01T09:00:00.000Z');
  });

  it('says Not saved yet for a layout that has never been saved', () => {
    renderEditor({ template: { template_id: undefined, updated_at: undefined, created_at: undefined } });

    expect(byId('document-template-save-status').textContent).toBe('Not saved yet');
  });

  it('closes with onCancel', async () => {
    const { onCancel } = renderEditor();

    await userEvent.click(byId('document-template-editor-close'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('saves the edited name and version, and disables Save while saving', async () => {
    let finishSave: (value: unknown) => void = () => undefined;
    saveDocumentTemplateMock.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    renderEditor();

    const name = byId<HTMLInputElement>('document-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Edited layout');
    fireEvent.change(byId('document-template-version-input'), { target: { value: '6' } });

    await userEvent.click(byId('document-template-editor-save'));

    expect(byId<HTMLButtonElement>('document-template-editor-save').disabled).toBe(true);
    expect(saveDocumentTemplateMock).toHaveBeenCalledWith(
      'sales-order',
      expect.objectContaining({ name: 'Edited layout', version: 6 })
    );

    finishSave({ success: true, template_id: 'template-1' });
    await waitFor(() => expect(byId<HTMLButtonElement>('document-template-editor-save').disabled).toBe(false));
  });

  it('renders a failed save inside the card header', async () => {
    saveDocumentTemplateMock.mockResolvedValue({ success: false, error: 'Layout name is taken' });
    renderEditor();

    await userEvent.click(byId('document-template-editor-save'));

    await waitFor(() => expect(byId('document-template-editor-error-alert')).not.toBeNull());
    const alert = byId('document-template-editor-error-alert');
    expect(alert.textContent).toContain('Layout name is taken');
    expect(alert.closest('.p-6')!.contains(byId('document-template-editor-back'))).toBe(true);
  });
});
