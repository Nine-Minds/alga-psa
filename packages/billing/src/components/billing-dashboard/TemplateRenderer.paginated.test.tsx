// @vitest-environment jsdom

/**
 * A layout with page breaks has to be read as the pages it prints as — the single endless roll
 * cannot show a cover page, a pricing page and a signature page as three pages. The renderer
 * asks the server for the paginated document and frames it; if that pass could not run, it
 * falls back to the inline fragment in the caller's own paper shell.
 */
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renderTemplateOnServerMock = vi.fn();

vi.mock('@alga-psa/billing/actions/invoiceTemplates', () => ({
  renderTemplateOnServer: (...args: unknown[]) => renderTemplateOnServerMock(...args),
}));

vi.mock('../invoice-designer/preview/PreviewSheetFrame', () => ({
  PreviewSheetFrame: (props: { html: string; automationId?: string }) => (
    <div data-automation-id={props.automationId}>{props.html}</div>
  ),
}));

import { TemplateRenderer } from './TemplateRenderer';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const template = { template_id: 'tpl-1', templateAst: { kind: 'invoice-template-ast' } } as never;
const invoiceData = { invoiceNumber: 'INV-1', items: [], subtotal: 0, tax: 0, total: 0 } as never;

describe('TemplateRenderer paginated mode', () => {
  it('frames the paginated document and asks the server to paginate', async () => {
    renderTemplateOnServerMock.mockResolvedValue({
      html: '<p>fragment</p>',
      css: '',
      documentHtml: '<html><body>two sheets</body></html>',
    });

    render(<TemplateRenderer template={template} invoiceData={invoiceData} paginated />);

    expect(await screen.findByText('<html><body>two sheets</body></html>')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="invoice-preview-pages"]')).toBeTruthy();
    await waitFor(() => expect(renderTemplateOnServerMock).toHaveBeenCalled());
    expect(renderTemplateOnServerMock.mock.calls.at(-1)?.[2]).toMatchObject({ paginate: true });
  });

  it("falls back to the fragment in the caller's paper shell when no paginated document came back", async () => {
    renderTemplateOnServerMock.mockResolvedValue({ html: '<p>fragment</p>', css: '' });

    render(
      <TemplateRenderer
        template={template}
        invoiceData={invoiceData}
        paginated
        fallbackWrapper={(fragment) => <div data-automation-id="paper-shell">{fragment}</div>}
      />,
    );

    await waitFor(() => expect(document.querySelector('[data-automation-id="paper-shell"]')).toBeTruthy());
    expect(document.querySelector('[data-automation-id="invoice-preview-pages"]')).toBeNull();
    expect(document.querySelector('[data-automation-id="paper-shell"]')?.textContent).toContain('fragment');
  });

  it('leaves an unpaginated caller on the inline fragment, with no chunking pass asked for', async () => {
    renderTemplateOnServerMock.mockResolvedValue({ html: '<p>fragment</p>', css: '' });

    render(<TemplateRenderer template={template} invoiceData={invoiceData} />);

    await waitFor(() => expect(renderTemplateOnServerMock).toHaveBeenCalled());
    expect(renderTemplateOnServerMock.mock.calls.at(-1)?.[2]).toMatchObject({ paginate: false });
    expect(document.querySelector('[data-automation-id="invoice-preview-pages"]')).toBeNull();
  });
});
