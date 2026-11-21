// @vitest-environment jsdom
/**
 * Focus mode on the document layout editor: one preference for every document type, the whole
 * header row (Label settings included) still usable, and the card chrome gone.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preferences = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserPreference: vi.fn(),
  setUserPreference: vi.fn(),
}));
const saveDocumentTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => preferences.getCurrentUser(...args),
  getUserPreference: (...args: unknown[]) => preferences.getUserPreference(...args),
  setUserPreference: (...args: unknown[]) => preferences.setUserPreference(...args),
}));

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

import DocumentTemplateEditor from './DocumentTemplateEditor';
import { getDocumentTypeStandardAst } from '../../../lib/document-templates/registry';

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const surface = () => byId('document-template-editor-surface');

function renderEditor(documentType = 'sales-order') {
  return render(
    <DocumentTemplateEditor
      documentType={documentType}
      template={{
        template_id: 'template-1',
        name: 'Order Confirmation',
        version: 2,
        templateAst: getDocumentTypeStandardAst(documentType as any),
      }}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
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
  window.localStorage.clear();
  preferences.getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  preferences.getUserPreference.mockResolvedValue(null);
  preferences.setUserPreference.mockResolvedValue(undefined);
  saveDocumentTemplateMock.mockResolvedValue({ success: true, template_id: 'template-1' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('document layout editor focus mode', () => {
  it('puts the toggle before Close and saves the document preference', async () => {
    renderEditor();

    const toggle = byId('document-template-editor-focus-toggle');
    const close = byId('document-template-editor-close');
    expect(toggle.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(toggle);

    expect(surface().getAttribute('data-focus-mode')).toBe('on');
    await waitFor(() =>
      expect(preferences.setUserPreference).toHaveBeenCalledWith(
        'user-1',
        'designer_focus_mode_document_layout',
        true
      )
    );
  });

  it('keeps the whole header row, Label settings included, in focus mode', async () => {
    renderEditor('work-tag');
    await userEvent.click(byId('document-template-editor-focus-toggle'));

    expect(byId('document-template-name-input')).not.toBeNull();
    expect(byId('document-template-version-input')).not.toBeNull();
    expect(byId('document-template-save-status')).not.toBeNull();
    expect(byId('document-template-label-settings')).not.toBeNull();
    expect(byId('document-template-editor-close')).not.toBeNull();
    expect(byId('document-template-editor-save')).not.toBeNull();

    const card = surface().firstElementChild as HTMLElement;
    expect(card.className).toContain('border-0');
    expect(card.className).toContain('rounded-none');
    expect(card.style.boxShadow).toBe('none');
  });

  it('changes the label class and hidden fields from the popover in focus mode', async () => {
    renderEditor('work-tag');
    await userEvent.click(byId('document-template-editor-focus-toggle'));

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

  it('opens focused for one document type from a preference saved while editing another', async () => {
    preferences.getUserPreference.mockImplementation(async (_userId: string, key: string) =>
      key === 'designer_focus_mode_document_layout' ? true : null
    );

    renderEditor('work-tag');
    await waitFor(() => expect(surface().getAttribute('data-focus-mode')).toBe('on'));

    cleanup();
    renderEditor('sales-order');
    await waitFor(() => expect(surface().getAttribute('data-focus-mode')).toBe('on'));
  });

  it('keeps an edited name across entering and leaving focus mode', async () => {
    renderEditor();

    const name = byId<HTMLInputElement>('document-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kept name');

    await userEvent.click(byId('document-template-editor-focus-toggle'));
    expect(surface().getAttribute('data-focus-mode')).toBe('on');
    await userEvent.click(byId('document-template-editor-focus-toggle'));

    expect(surface().getAttribute('data-focus-mode')).toBe('off');
    expect(byId<HTMLInputElement>('document-template-name-input').value).toBe('Kept name');
  });
});
