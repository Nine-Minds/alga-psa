// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runAuthoritativeQuoteTemplatePreviewMock = vi.hoisted(() => vi.fn());
const getTenantBrandingForDocumentPreviewMock = vi.hoisted(() => vi.fn());

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

// The editor's existing-quote source imports the quote server actions; stub them so this suite
// stays on the sample path (and out of the server-only module graph).
vi.mock('../../../actions/quoteActions', () => ({
  listQuotes: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 10, totalPages: 1 })),
  getQuoteForRendering: vi.fn(async () => null),
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
  TemplateRenderer: () => <div data-automation-id="template-renderer-mock" />,
}));

// Stable identities: the editor's preview effect lists `t` in its dependency array, and
// react-i18next hands back a stable `t` — a fresh one per render would spin the pipeline forever.
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

const latestPreviewTenant = () =>
  runAuthoritativeQuoteTemplatePreviewMock.mock.calls.at(-1)?.[0]?.quoteData?.tenant;

// The session reducer seeds the invoice sample id, so a quote scenario has to be picked before the
// preview pipeline has data to run against.
const openPreviewWithSampleScenario = async () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Select scenario...' }));
  fireEvent.click(await screen.findByText('Simple Quote'));
};

describe('QuoteDocumentTemplateEditor tenant branding preview', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    runAuthoritativeQuoteTemplatePreviewMock.mockReset();
    getTenantBrandingForDocumentPreviewMock.mockReset();
    getTenantBrandingForDocumentPreviewMock.mockResolvedValue(null);
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

  it('renders the tenant real branding on the sample quote preview', async () => {
    getTenantBrandingForDocumentPreviewMock.mockResolvedValue({
      name: 'Cascade IT Partners',
      address: '88 Pearl St, Boulder, CO 80302',
      email: 'billing@cascadeit.example',
      phone: '+1-303-555-0114',
      logo_url: 'https://cdn.example/logo.png',
    });

    render(<QuoteDocumentTemplateEditor templateId={null} />);
    await openPreviewWithSampleScenario();

    await waitFor(() =>
      expect(latestPreviewTenant()).toEqual({
        name: 'Cascade IT Partners',
        address: '88 Pearl St, Boulder, CO 80302',
        email: 'billing@cascadeit.example',
        phone: '+1-303-555-0114',
        logo_url: 'https://cdn.example/logo.png',
      })
    );
    // The rest of the sample scenario must survive the overlay untouched.
    expect(runAuthoritativeQuoteTemplatePreviewMock.mock.calls.at(-1)?.[0]?.quoteData?.quote_number).toBe(
      'QT-2026-0042'
    );
  });

  it('keeps the synthetic sample issuer when the tenant has no resolvable branding', async () => {
    render(<QuoteDocumentTemplateEditor templateId={null} />);
    await openPreviewWithSampleScenario();

    await waitFor(() => expect(runAuthoritativeQuoteTemplatePreviewMock).toHaveBeenCalled());
    expect(latestPreviewTenant()).toEqual({
      name: 'Northwind MSP',
      address: '400 SW Main St, Portland, OR 97204',
    });
  });

  it('falls back to the synthetic issuer when the branding lookup fails', async () => {
    getTenantBrandingForDocumentPreviewMock.mockRejectedValue(new Error('no session'));

    render(<QuoteDocumentTemplateEditor templateId={null} />);
    await openPreviewWithSampleScenario();

    await waitFor(() => expect(runAuthoritativeQuoteTemplatePreviewMock).toHaveBeenCalled());
    expect(latestPreviewTenant()).toEqual({
      name: 'Northwind MSP',
      address: '400 SW Main St, Portland, OR 97204',
    });
  });
});
