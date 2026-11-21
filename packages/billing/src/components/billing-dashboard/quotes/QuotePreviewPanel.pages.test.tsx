// @vitest-environment jsdom

/**
 * The quote preview is where a multi-page quote is read before it is sent: a cover page, a
 * "why this quote" page, a timeline, pricing and a signature page have to show as the pages
 * they print as. The panel asks for the paginated document and frames it; the single roll
 * stays as the fallback for when that chunking pass could not run.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderQuotePreviewMock = vi.fn();

vi.mock('../../../actions/quoteActions', () => ({
  renderQuotePreview: (...args: unknown[]) => renderQuotePreviewMock(...args),
  updateQuote: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: (props: { id?: string }) => <div data-automation-id={props.id} />,
}));

vi.mock('../../invoice-designer/preview/PreviewSheetFrame', () => ({
  PreviewSheetFrame: (props: { html: string; automationId?: string }) => (
    <div data-automation-id={props.automationId}>{props.html}</div>
  ),
}));

import QuotePreviewPanel from './QuotePreviewPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const templates = [{ template_id: 'tpl-1', name: 'Standard', isStandard: true }] as never;

describe('QuotePreviewPanel pages', () => {
  it('asks for the paginated quote and frames its sheets', async () => {
    renderQuotePreviewMock.mockResolvedValue({
      html: '<p>roll</p>',
      css: '',
      documentHtml: '<html><body>five sheets</body></html>',
    });

    render(<QuotePreviewPanel quoteId="q-1" templates={templates} selectedTemplateId="tpl-1" />);

    expect(await screen.findByText('<html><body>five sheets</body></html>')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="quote-preview-pages"]')).toBeTruthy();
    expect(renderQuotePreviewMock.mock.calls.at(-1)?.[2]).toMatchObject({ paginate: true });
  });

  it('keeps the single roll when no paginated document came back', async () => {
    renderQuotePreviewMock.mockResolvedValue({ html: '<p>roll</p>', css: '' });

    render(<QuotePreviewPanel quoteId="q-1" templates={templates} selectedTemplateId="tpl-1" />);

    await waitFor(() => expect(screen.getByText('roll')).toBeTruthy());
    expect(document.querySelector('[data-automation-id="quote-preview-pages"]')).toBeNull();
  });
});
