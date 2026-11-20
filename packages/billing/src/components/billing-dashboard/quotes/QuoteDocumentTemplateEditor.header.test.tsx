// @vitest-environment jsdom
/**
 * The quote layout editor's compact header row: one card, everything the job needs on it, and
 * nothing left in a details card or a footer.
 */
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.hoisted(() => vi.fn());
const getQuoteDocumentTemplateMock = vi.hoisted(() => vi.fn());
const saveQuoteDocumentTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
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

beforeEach(() => {
  getQuoteDocumentTemplateMock.mockResolvedValue(savedTemplate);
  saveQuoteDocumentTemplateMock.mockResolvedValue({ success: true, template: { ...savedTemplate } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderEditor(props: Partial<React.ComponentProps<typeof QuoteDocumentTemplateEditor>> = {}) {
  const result = render(<QuoteDocumentTemplateEditor templateId="template-1" {...props} />);
  await waitFor(() => expect(byId('quote-template-name-input')).not.toBeNull());
  return result;
}

describe('quote layout editor header row', () => {
  it('drops the details card, the description and the footer', async () => {
    const { container } = await renderEditor();

    expect(container.textContent).not.toContain('Layout Details');
    expect(container.textContent).not.toContain('Design the quote layout using the visual editor');
    expect(container.textContent).not.toContain('Last Updated');
    expect(container.textContent).not.toContain('Created:');
  });

  it('puts the header row and the Visual / Code tabs in one card', async () => {
    const { container } = await renderEditor();

    // The focus surface wraps the card; the card is still the only one.
    const card = byId('quote-template-editor-surface').firstElementChild as HTMLElement;
    expect(card.className).toContain('card-elevated');
    expect(card.contains(byId('quote-template-editor-back'))).toBe(true);
    expect(card.contains(byId('quote-template-name-input'))).toBe(true);
    expect(card.querySelector('[data-automation-id="quote-template-editor-visual-tab"]')).not.toBeNull();
    expect(card.querySelector('[data-automation-id="quote-template-editor-code-tab"]')).not.toBeNull();
  });

  it('calls onBack from the back navigation when it is given one', async () => {
    const onBack = vi.fn();
    await renderEditor({ onBack });

    await userEvent.click(byId('quote-template-editor-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('falls back to the quote layouts tab without onBack', async () => {
    await renderEditor();

    await userEvent.click(byId('quote-template-editor-back'));

    expect(pushMock).toHaveBeenCalledWith('/msp/billing?tab=quote-templates');
  });

  it('titles an existing layout with its name and follows the name as it is typed', async () => {
    const { container } = await renderEditor();

    expect(container.textContent).toContain('Edit Layout: Standard quote');

    const name = byId<HTMLInputElement>('quote-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed quote layout');

    expect(container.textContent).toContain('Edit Layout: Renamed quote layout');
    expect(container.querySelector('h2')!.className).toContain('truncate');
  });

  it('titles a new layout New Quote Layout', async () => {
    const { container } = render(<QuoteDocumentTemplateEditor templateId={null} />);
    await waitFor(() => expect(byId('quote-template-name-input')).not.toBeNull());

    expect(container.textContent).toContain('New Quote Layout');
  });

  it('keeps the name input in the header, filled and enabled once loaded', async () => {
    await renderEditor();

    const name = byId<HTMLInputElement>('quote-template-name-input');
    expect(name.value).toBe('Standard quote');
    expect(name.disabled).toBe(false);
    expect(byId('quote-template-editor-back').parentElement!.contains(name)).toBe(true);
  });

  it('clamps the version to whole numbers of at least 1', async () => {
    await renderEditor();

    const version = byId<HTMLInputElement>('quote-template-version-input');
    expect(version.value).toBe('3');

    // A number input hands the component whatever was typed; the clamp is what keeps it legal.
    for (const typed of ['0', '-4', 'abc']) {
      fireEvent.change(version, { target: { value: typed } });
      expect(byId<HTMLInputElement>('quote-template-version-input').value).toBe('1');
    }
  });

  it('shows the saved time, the created date as its tooltip, and announces changes politely', async () => {
    await renderEditor();

    const status = byId('quote-template-save-status');
    expect(status.textContent).toBe('Saved on 2026-11-18T09:00:00.000Z');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('title')).toBe('Created on 2026-11-01T09:00:00.000Z');
  });

  it('says Not saved yet for a new layout', async () => {
    render(<QuoteDocumentTemplateEditor templateId={null} />);
    await waitFor(() => expect(byId('quote-template-save-status')).not.toBeNull());

    expect(byId('quote-template-save-status').textContent).toBe('Not saved yet');
  });

  it('shows the new saved time after a successful save', async () => {
    saveQuoteDocumentTemplateMock.mockResolvedValue({
      success: true,
      template: { ...savedTemplate, updated_at: '2026-11-20T12:00:00.000Z' },
    });
    await renderEditor();

    await userEvent.click(byId('quote-template-editor-save'));

    await waitFor(() =>
      expect(byId('quote-template-save-status').textContent).toBe('Saved on 2026-11-20T12:00:00.000Z')
    );
  });

  it('closes with the same behaviour as the back navigation', async () => {
    const onBack = vi.fn();
    await renderEditor({ onBack });

    await userEvent.click(byId('quote-template-editor-close'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('saves the edited name and version, and disables Save while saving', async () => {
    let finishSave: (value: unknown) => void = () => undefined;
    saveQuoteDocumentTemplateMock.mockReturnValue(
      new Promise((resolve) => {
        finishSave = resolve;
      })
    );
    await renderEditor();

    const name = byId<HTMLInputElement>('quote-template-name-input');
    await userEvent.clear(name);
    await userEvent.type(name, 'Edited layout');
    fireEvent.change(byId('quote-template-version-input'), { target: { value: '7' } });

    await userEvent.click(byId('quote-template-editor-save'));

    expect(byId<HTMLButtonElement>('quote-template-editor-save').disabled).toBe(true);
    expect(saveQuoteDocumentTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Edited layout', version: 7 })
    );

    finishSave({ success: true, template: savedTemplate });
    await waitFor(() => expect(byId<HTMLButtonElement>('quote-template-editor-save').disabled).toBe(false));
  });

  it('renders a load failure inside the card header', async () => {
    getQuoteDocumentTemplateMock.mockRejectedValue(new Error('Template is gone'));
    render(<QuoteDocumentTemplateEditor templateId="template-1" />);

    await waitFor(() => expect(byId('quote-template-editor-error-alert')).not.toBeNull());
    const alert = byId('quote-template-editor-error-alert');
    expect(alert.textContent).toContain('Template is gone');
    expect(alert.closest('.p-6')!.contains(byId('quote-template-editor-back'))).toBe(true);
  });

  it('pre-fills the name from a standard layout code', async () => {
    render(<QuoteDocumentTemplateEditor templateId={null} standardCode="standard-quote-detailed" />);
    await waitFor(() => expect(byId('quote-template-name-input')).not.toBeNull());

    expect(byId<HTMLInputElement>('quote-template-name-input').value).toBe('Copy of Detailed');
  });
});
