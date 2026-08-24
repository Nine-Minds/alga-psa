// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runAuthoritativeQuoteTemplatePreviewMock = vi.hoisted(() => vi.fn());
const getTenantBrandingForDocumentPreviewMock = vi.hoisted(() => vi.fn());
const listQuotesMock = vi.hoisted(() => vi.fn());
const getQuoteForRenderingMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@monaco-editor/react', () => ({
  Editor: () => <div data-automation-id="monaco-editor-mock" />,
}));

vi.mock('../../../actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplate: vi.fn(),
  saveQuoteDocumentTemplate: vi.fn(),
}));

vi.mock('../../../actions/quoteActions', () => ({
  listQuotes: (...args: unknown[]) => listQuotesMock(...args),
  getQuoteForRendering: (...args: unknown[]) => getQuoteForRenderingMock(...args),
}));

vi.mock('../../../actions/quoteTemplatePreview', () => ({
  runAuthoritativeQuoteTemplatePreview: (...args: unknown[]) =>
    runAuthoritativeQuoteTemplatePreviewMock(...args),
}));

vi.mock('../../../actions/tenantBrandingPreview', () => ({
  getTenantBrandingForDocumentPreview: (...args: unknown[]) =>
    getTenantBrandingForDocumentPreviewMock(...args),
}));

vi.mock('../../invoice-designer/DesignerShell', () => ({
  DesignerShell: () => <div data-automation-id="designer-shell-mock">Designer Shell</div>,
}));

vi.mock('../../invoice-designer/transforms/TransformsWorkspace', () => ({
  default: () => <div data-automation-id="transforms-workspace-mock">Transforms</div>,
}));

vi.mock('../PaperInvoice', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-automation-id="paper-invoice-mock">{children}</div>
  ),
}));

vi.mock('../TemplateRenderer', () => ({
  TemplateRenderer: (props: any) => (
    <div data-automation-id="template-renderer-mock">{props?.invoiceData?.quote_number ?? 'NO_QUOTE'}</div>
  ),
}));

// Stable identities: the preview effect lists `t` in its dependency array, and react-i18next hands
// back a stable `t` — a fresh one per render would spin the pipeline forever.
const i18nStubs = vi.hoisted(() => ({
  formatters: { formatDate: (value: string) => value },
  translation: {
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => i18nStubs.formatters,
  useTranslation: () => i18nStubs.translation,
}));

import QuoteDocumentTemplateEditor from './QuoteDocumentTemplateEditor';

const buildQuoteListResult = (overrides: Partial<any> = {}) => ({
  data: [
    { quote_id: 'quote-1', display_quote_number: 'QT-2026-0100', client_name: 'Acme Co.' },
    { quote_id: 'quote-2', display_quote_number: 'QT-2026-0101', client_name: 'Globex' },
  ],
  total: 2,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  ...overrides,
});

const buildQuoteViewModel = (overrides: Partial<any> = {}) => ({
  quote_id: 'quote-1',
  quote_number: 'QT-2026-0100',
  title: 'Network refresh',
  currency_code: 'USD',
  client: { name: 'Acme Co.', address: '123 Main St' },
  tenant: {
    name: 'Emerald City IT',
    address: '1010 Emerald Street, Emerald City, OZ',
    email: 'billing@emerald.example',
    phone: '+1-555-0100',
    logo_url: 'https://cdn.example/emerald.png',
  },
  line_items: [],
  subtotal: 1000,
  tax: 0,
  total_amount: 1000,
  ...overrides,
});

// The preview panel holds the quote picker and the preview-language select; `combobox` takes no
// accessible name from content, so target the picker by component.
const openExistingQuoteSelect = async () => {
  const trigger = await waitFor(() => {
    const element = document.querySelector(
      '[data-automation-type="async-searchable-select"] button[role="combobox"]'
    );
    if (!element) throw new Error('Existing-quote select is not rendered');
    return element as HTMLElement;
  });
  fireEvent.click(trigger);
};

const latestPreviewQuoteData = () =>
  runAuthoritativeQuoteTemplatePreviewMock.mock.calls.at(-1)?.[0]?.quoteData;

describe('QuoteDocumentTemplateEditor existing-quote preview', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    runAuthoritativeQuoteTemplatePreviewMock.mockReset();
    getTenantBrandingForDocumentPreviewMock.mockReset();
    listQuotesMock.mockReset();
    getQuoteForRenderingMock.mockReset();
    getTenantBrandingForDocumentPreviewMock.mockResolvedValue(null);
    listQuotesMock.mockResolvedValue(buildQuoteListResult());
    getQuoteForRenderingMock.mockResolvedValue(buildQuoteViewModel());
    runAuthoritativeQuoteTemplatePreviewMock.mockResolvedValue({
      success: true,
      sourceHash: 'hash',
      generatedSource: '{}',
      compile: { status: 'success', diagnostics: [] },
      render: { status: 'success', html: '<div />', css: '' },
      verification: { status: 'pass', mismatches: [] },
    });
  });

  afterEach(() => {
    cleanup();
  });

  const openPreviewTab = () => {
    render(<QuoteDocumentTemplateEditor templateId={null} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  };

  it('offers a sample / existing source switcher on the preview tab', () => {
    openPreviewTab();

    expect(screen.getByRole('button', { name: 'Sample' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Existing' })).toBeTruthy();
  });

  it('swaps the sample scenario picker for a quote picker in Existing mode', async () => {
    openPreviewTab();

    expect(screen.getByRole('combobox', { name: 'Select scenario...' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));

    expect(screen.queryByRole('combobox', { name: 'Select scenario...' })).toBeNull();
    // Shown both beside the picker and in the render area until a quote is chosen.
    expect(screen.getAllByText('Select a quote to preview data-bound output.').length).toBeGreaterThan(0);

    await openExistingQuoteSelect();
    await waitFor(() => expect(listQuotesMock).toHaveBeenCalled());
    expect(listQuotesMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, sortBy: 'quote_date', sortOrder: 'desc' })
    );
    expect(await screen.findByText('QT-2026-0101 · Globex')).toBeTruthy();
  });

  it('renders an existing quote through the layout with its own persisted branding', async () => {
    openPreviewTab();
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await openExistingQuoteSelect();
    fireEvent.click(await screen.findByText('QT-2026-0100 · Acme Co.'));

    await waitFor(() => expect(getQuoteForRenderingMock).toHaveBeenCalledWith('quote-1'));
    await waitFor(() => expect(latestPreviewQuoteData()?.quote_number).toBe('QT-2026-0100'));
    // The sample-only branding overlay must not touch a real quote's issuer.
    expect(latestPreviewQuoteData()?.tenant).toEqual({
      name: 'Emerald City IT',
      address: '1010 Emerald Street, Emerald City, OZ',
      email: 'billing@emerald.example',
      phone: '+1-555-0100',
      logo_url: 'https://cdn.example/emerald.png',
    });
    expect(await screen.findByText('QT-2026-0100')).toBeTruthy();
  });

  it('surfaces an error when the selected quote cannot be loaded', async () => {
    getQuoteForRenderingMock.mockResolvedValue(null);

    openPreviewTab();
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await openExistingQuoteSelect();
    fireEvent.click(await screen.findByText('QT-2026-0100 · Acme Co.'));

    expect(await screen.findByText('Could not load quote details for preview.')).toBeTruthy();
    expect(runAuthoritativeQuoteTemplatePreviewMock).not.toHaveBeenCalled();
  });

  it('guards against stale quote detail responses when the selection changes quickly', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    getQuoteForRenderingMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    openPreviewTab();
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    await openExistingQuoteSelect();
    fireEvent.click(await screen.findByText('QT-2026-0100 · Acme Co.'));
    await openExistingQuoteSelect();
    fireEvent.click(await screen.findByText('QT-2026-0101 · Globex'));

    resolveFirst(buildQuoteViewModel());
    resolveSecond(buildQuoteViewModel({ quote_id: 'quote-2', quote_number: 'QT-2026-0101' }));

    await waitFor(() => expect(latestPreviewQuoteData()?.quote_number).toBe('QT-2026-0101'));
    expect(
      runAuthoritativeQuoteTemplatePreviewMock.mock.calls.some(
        (call) => call[0]?.quoteData?.quote_number === 'QT-2026-0100'
      )
    ).toBe(false);
  });
});
