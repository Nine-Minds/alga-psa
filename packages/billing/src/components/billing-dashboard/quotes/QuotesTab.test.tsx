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
const navigationMocks = vi.hoisted(() => ({ searchParams: 'subtab=sent' }));
const quoteFormPropsMock = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
const customTabsPropsMock = vi.hoisted(() => ({
  current: null as null | { tabs: Array<{ id: string; label: string }> },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigationMocks.searchParams),
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
    t: (key: string, options?: { defaultValue?: string; count?: number }) => {
      const template = options?.defaultValue ?? key;
      return options?.count === undefined
        ? template
        : template.replace('{{count}}', String(options.count));
    },
  }),
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  CustomTabs: ({ tabs, defaultTab }: { tabs: Array<{ id: string; label: string; content: React.ReactNode }>; defaultTab: string }) => {
    customTabsPropsMock.current = { tabs };
    return <div>{tabs.find((tab) => tab.id === defaultTab)?.content}</div>;
  },
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
vi.mock('./QuoteForm', () => ({
  default: (props: Record<string, unknown>) => {
    quoteFormPropsMock.current = props;
    return null;
  },
}));
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

const draftQuote = {
  ...sentQuote,
  quote_id: 'quote-draft-1',
  display_quote_number: 'Q-1000',
  status: 'draft',
  title: 'Draft quote',
};

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe('QuotesTab sent quote actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    navigationMocks.searchParams = 'subtab=sent';
    quoteFormPropsMock.current = null;
    customTabsPropsMock.current = null;
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

  it('T001: a deep link carrying a source template id reaches QuoteForm through initialContext', async () => {
    navigationMocks.searchParams = 'tab=quotes&quoteId=new&sourceTemplateId=tmpl-123';

    render(<QuotesTab />);

    await waitFor(() => expect(quoteFormPropsMock.current).not.toBeNull());
    expect(quoteFormPropsMock.current).toMatchObject({
      quoteId: 'new',
      initialContext: { sourceTemplateId: 'tmpl-123' },
    });
  });

  it('T002: a detail-view status change refreshes the list in the background without a loading flash', async () => {
    navigationMocks.searchParams = 'tab=quotes&quoteId=quote-draft-1&mode=detail';
    const refreshDeferred = createDeferred<{ data: unknown[] }>();
    actionMocks.listQuotes
      .mockResolvedValueOnce({ data: [draftQuote] })
      .mockReturnValueOnce(refreshDeferred.promise);

    const view = render(<QuotesTab />);

    // Initial load mounts the detail form; the list is not rendered yet.
    await waitFor(() => expect(quoteFormPropsMock.current).not.toBeNull());
    expect(actionMocks.listQuotes).toHaveBeenCalledTimes(1);

    const onQuoteStatusChanged = quoteFormPropsMock.current?.onQuoteStatusChanged as
      | (() => Promise<void>)
      | undefined;
    expect(typeof onQuoteStatusChanged).toBe('function');

    const refresh = onQuoteStatusChanged!();
    await waitFor(() => expect(actionMocks.listQuotes).toHaveBeenCalledTimes(2));

    // While the background fetch is in flight the detail form stays mounted and
    // the list-level loading card must not replace it.
    expect(quoteFormPropsMock.current).not.toBeNull();
    expect(screen.queryByText('Loading quotes...')).toBeNull();

    refreshDeferred.resolve({ data: [sentQuote] });
    await refresh;

    // Simulate returning to the list: only searchParams change, so the mounted
    // component keeps its refreshed snapshot and must show current membership
    // and counts.
    navigationMocks.searchParams = 'tab=quotes&subtab=active';
    view.rerender(<QuotesTab />);

    await waitFor(() => expect(screen.getByText('No quotes in this category.')).toBeTruthy());
    expect(customTabsPropsMock.current?.tabs.find((tab) => tab.id === 'active')?.label).toBe('Active (0)');
    await waitFor(() =>
      expect(customTabsPropsMock.current?.tabs.find((tab) => tab.id === 'sent')?.label).toBe('Sent (1)'),
    );
  });
});
