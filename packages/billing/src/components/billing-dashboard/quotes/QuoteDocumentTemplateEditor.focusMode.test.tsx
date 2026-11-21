// @vitest-environment jsdom
/**
 * Focus mode on the quote layout editor: the header row stays whole and usable, the card loses
 * its chrome, and the author's choice is saved under the quote key.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const preferences = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getUserPreference: vi.fn(),
  setUserPreference: vi.fn(),
}));
const getQuoteDocumentTemplateMock = vi.hoisted(() => vi.fn());
const saveQuoteDocumentTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => preferences.getCurrentUser(...args),
  getUserPreference: (...args: unknown[]) => preferences.getUserPreference(...args),
  setUserPreference: (...args: unknown[]) => preferences.setUserPreference(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@monaco-editor/react', () => ({
  Editor: () => <div data-automation-id="monaco-editor-mock" />,
}));

vi.mock('../../../actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplate: (...args: unknown[]) => getQuoteDocumentTemplateMock(...args),
  saveQuoteDocumentTemplate: (...args: unknown[]) => saveQuoteDocumentTemplateMock(...args),
}));

vi.mock('../../../actions/quoteActions', () => ({
  listQuotes: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getQuoteForRendering: vi.fn(),
}));

vi.mock('../../../actions/quoteTemplatePreview', () => ({
  runAuthoritativeQuoteTemplatePreview: vi.fn(),
}));

vi.mock('../../../actions/tenantBrandingPreview', () => ({
  getTenantBrandingForDocumentPreview: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../invoice-designer/DesignerShell', () => ({
  DesignerShell: () => <div data-automation-id="designer-shell-mock">Designer Shell</div>,
}));

vi.mock('../../invoice-designer/transforms/TransformsWorkspace', () => ({
  default: () => <div data-automation-id="transforms-workspace-mock">Transforms</div>,
}));

vi.mock('../PaperInvoice', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../TemplateRenderer', () => ({
  TemplateRenderer: () => <div data-automation-id="template-renderer-mock" />,
}));

import QuoteDocumentTemplateEditor from './QuoteDocumentTemplateEditor';

const savedTemplate = {
  template_id: 'template-1',
  name: 'Standard quote',
  version: 3,
  is_default: false,
  created_at: '2026-11-01T09:00:00.000Z',
  updated_at: '2026-11-18T09:00:00.000Z',
  templateAst: { kind: 'invoice-template-ast', version: 1, layout: { id: 'root', type: 'document', children: [] } },
};

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const surface = () => byId('quote-template-editor-surface');

beforeEach(() => {
  window.localStorage.clear();
  preferences.getCurrentUser.mockResolvedValue({ user_id: 'user-1' });
  preferences.getUserPreference.mockResolvedValue(null);
  preferences.setUserPreference.mockResolvedValue(undefined);
  getQuoteDocumentTemplateMock.mockResolvedValue(savedTemplate);
  saveQuoteDocumentTemplateMock.mockResolvedValue({ success: true, template: savedTemplate });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderEditor() {
  const result = render(<QuoteDocumentTemplateEditor templateId="template-1" onBack={vi.fn()} />);
  await waitFor(() => expect(byId('quote-template-name-input')).not.toBeNull());
  return result;
}

describe('quote layout editor focus mode', () => {
  it('puts the toggle before Close and saves the quote preference', async () => {
    await renderEditor();

    const toggle = byId('quote-template-editor-focus-toggle');
    const close = byId('quote-template-editor-close');
    expect(toggle.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(toggle);

    expect(surface().getAttribute('data-focus-mode')).toBe('on');
    await waitFor(() =>
      expect(preferences.setUserPreference).toHaveBeenCalledWith(
        'user-1',
        'designer_focus_mode_quote_layout',
        true
      )
    );
  });

  it('keeps the whole header row, without card chrome, in focus mode', async () => {
    await renderEditor();
    await userEvent.click(byId('quote-template-editor-focus-toggle'));

    expect(byId('quote-template-name-input')).not.toBeNull();
    expect(byId('quote-template-version-input')).not.toBeNull();
    expect(byId('quote-template-save-status')).not.toBeNull();
    expect(byId('quote-template-editor-close')).not.toBeNull();
    expect(byId('quote-template-editor-save')).not.toBeNull();

    const card = surface().firstElementChild as HTMLElement;
    expect(card.className).toContain('border-0');
    expect(card.className).toContain('rounded-none');
    expect(card.style.boxShadow).toBe('none');
  });

  it('still shows a load error in focus mode', async () => {
    preferences.getUserPreference.mockResolvedValue(true);
    getQuoteDocumentTemplateMock.mockRejectedValue(new Error('Template is gone'));
    render(<QuoteDocumentTemplateEditor templateId="template-1" />);

    await waitFor(() => expect(surface()?.getAttribute('data-focus-mode')).toBe('on'));
    expect(byId('quote-template-editor-error-alert').textContent).toContain('Template is gone');
  });

  it('saves a name and version edited in focus mode', async () => {
    await renderEditor();
    await userEvent.click(byId('quote-template-editor-focus-toggle'));

    const name = byId<HTMLInputElement>('quote-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Focused layout');
    fireEvent.change(byId('quote-template-version-input'), { target: { value: '9' } });

    await userEvent.click(byId('quote-template-editor-save'));

    await waitFor(() =>
      expect(saveQuoteDocumentTemplateMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Focused layout', version: 9 })
      )
    );
  });

  it('keeps an edited name across entering and leaving focus mode', async () => {
    await renderEditor();

    const name = byId<HTMLInputElement>('quote-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kept name');

    await userEvent.click(byId('quote-template-editor-focus-toggle'));
    expect(surface().getAttribute('data-focus-mode')).toBe('on');
    await userEvent.click(byId('quote-template-editor-focus-toggle'));

    expect(surface().getAttribute('data-focus-mode')).toBe('off');
    expect(byId<HTMLInputElement>('quote-template-name-input').value).toBe('Kept name');
  });
});
