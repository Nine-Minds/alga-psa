// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  createQuoteRevision: vi.fn(),
  deleteQuote: vi.fn(),
  downloadQuotePdf: vi.fn(),
  duplicateQuote: vi.fn(),
  listQuotes: vi.fn(),
  resendQuote: vi.fn(),
  sendQuote: vi.fn(),
  sendQuoteReminder: vi.fn(),
}));
const getQuoteDocumentTemplatesMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('subtab=sent'),
}));

vi.mock('../../../actions/quoteActions', () => ({
  createQuoteRevision: (...args: unknown[]) => actionMocks.createQuoteRevision(...args),
  deleteQuote: (...args: unknown[]) => actionMocks.deleteQuote(...args),
  downloadQuotePdf: (...args: unknown[]) => actionMocks.downloadQuotePdf(...args),
  duplicateQuote: (...args: unknown[]) => actionMocks.duplicateQuote(...args),
  listQuotes: (...args: unknown[]) => actionMocks.listQuotes(...args),
  resendQuote: (...args: unknown[]) => actionMocks.resendQuote(...args),
  sendQuote: (...args: unknown[]) => actionMocks.sendQuote(...args),
  sendQuoteReminder: (...args: unknown[]) => actionMocks.sendQuoteReminder(...args),
}));

vi.mock('../../../actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplates: (...args: unknown[]) => getQuoteDocumentTemplatesMock(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
    formatDate: (value: string) => value,
  }),
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  CustomTabs: ({ tabs, defaultTab }: { tabs: Array<{ id: string; content: React.ReactNode }>; defaultTab: string }) => (
    <div>{tabs.find((tab) => tab.id === defaultTab)?.content}</div>
  ),
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ data, columns }: {
    data: Array<Record<string, unknown>>;
    columns: Array<{ dataIndex: string; render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }>;
  }) => (
    <table>
      <tbody>
        {data.map((row) => (
          <tr key={String(row.quote_id)}>
            {columns.map((column) => (
              <td key={column.dataIndex}>
                {column.render ? column.render(row[column.dataIndex], row) : String(row[column.dataIndex] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, id, onClick }: { children: React.ReactNode; id?: string; onClick?: () => void }) => (
    <button id={id} type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: () => <div />,
}));

vi.mock('@alga-psa/ui/components/ClientNameCell', () => ({
  default: ({ clientName }: { clientName: string }) => <span>{clientName}</span>,
}));

vi.mock('./QuoteApprovalDashboard', () => ({ default: () => null }));
vi.mock('./QuoteForm', () => ({ default: () => null }));
vi.mock('./QuotePreviewPanel', () => ({ default: () => null }));
vi.mock('./QuoteStatusBadge', () => ({ default: () => null }));

import QuotesTab from './QuotesTab';

const sentQuote = {
  quote_id: 'quote-sent-1',
  client_id: 'client-1',
  client_name: 'Example Client',
  currency_code: 'USD',
  display_quote_number: 'Q-1001',
  quote_date: '2026-08-20',
  status: 'sent',
  title: 'Sent quote',
  total_amount: 10000,
};

describe('QuotesTab sent quote actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMocks.listQuotes.mockResolvedValue({ data: [sentQuote] });
    getQuoteDocumentTemplatesMock.mockResolvedValue([]);
    actionMocks.resendQuote.mockResolvedValue({});
    actionMocks.sendQuoteReminder.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it('resends a sent quote with resendQuote instead of sendQuote', async () => {
    render(<QuotesTab />);

    fireEvent.click(await screen.findByText('Resend'));

    await waitFor(() => expect(actionMocks.resendQuote).toHaveBeenCalledWith(sentQuote.quote_id));
    expect(actionMocks.sendQuote).not.toHaveBeenCalled();
  });

  it('sends a sent quote reminder with sendQuoteReminder instead of sendQuote', async () => {
    render(<QuotesTab />);

    fireEvent.click(await screen.findByText('Send Reminder'));

    await waitFor(() => expect(actionMocks.sendQuoteReminder).toHaveBeenCalledWith(sentQuote.quote_id));
    expect(actionMocks.sendQuote).not.toHaveBeenCalled();
  });
});
