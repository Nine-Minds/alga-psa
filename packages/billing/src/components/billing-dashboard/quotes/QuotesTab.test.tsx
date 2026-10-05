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
const senderActionMocks = vi.hoisted(() => ({ listSelectableSenders: vi.fn() }));
const navigationMocks = vi.hoisted(() => ({ searchParams: 'subtab=sent', push: vi.fn() }));
const quoteFormPropsMock = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
const customTabsPropsMock = vi.hoisted(() => ({
  current: null as null | { tabs: Array<{ id: string; label: string }> },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigationMocks.push }),
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

vi.mock('@alga-psa/email/senderActions', () => ({
  listSelectableSenders: (...args: unknown[]) => senderActionMocks.listSelectableSenders(...args),
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

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer, id }: {
    isOpen: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    id?: string;
  }) => (isOpen ? <div data-testid={id}>{children}{footer}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('./QuoteSendRecipientsField', () => ({
  QuoteSendRecipientsField: ({ value, onChange, id, clientId }: {
    value: Array<Record<string, unknown>>;
    onChange: (next: Array<Record<string, unknown>>) => void;
    id: string;
    clientId?: string | null;
  }) => (
    <div data-testid={`field-${id}`} data-client-id={clientId ?? ''}>
      <button
        type="button"
        onClick={() => onChange([
          ...value,
          { key: 'contact@example.com', email: 'Contact@Example.com', name: 'Contact', kind: 'contact', entityId: 'c1', avatarUrl: null },
        ])}
      >
        Pick Contact
      </button>
    </div>
  ),
}));

vi.mock('./QuoteApprovalDashboard', () => ({ default: () => null }));
vi.mock('./QuoteForm', () => ({
  default: (props: Record<string, unknown>) => {
    quoteFormPropsMock.current = props;
    return <div>
      <input aria-label="Draft title" defaultValue="" />
      <span data-testid="open-quote-id">{String(props.quoteId)}</span>
      <button onClick={() => (props.onSaved as (id: string) => void)('quote-created-1')}>
        Save test quote
      </button>
    </div>;
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
  client_id: 'client-draft-1',
  client_name: 'Draft Client',
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
    vi.restoreAllMocks();
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
    actionMocks.listQuotes.mockReturnValueOnce(refreshDeferred.promise);

    const view = render(<QuotesTab />);

    // Opening the detail form does not fetch the hidden list.
    await waitFor(() => expect(quoteFormPropsMock.current).not.toBeNull());
    expect(actionMocks.listQuotes).not.toHaveBeenCalled();

    const onQuoteStatusChanged = quoteFormPropsMock.current?.onQuoteStatusChanged as
      | (() => Promise<void>)
      | undefined;
    expect(typeof onQuoteStatusChanged).toBe('function');

    const refresh = onQuoteStatusChanged!();
    await waitFor(() => expect(actionMocks.listQuotes).toHaveBeenCalledTimes(1));

    // While the background fetch is in flight the detail form stays mounted and
    // the list-level loading card must not replace it.
    expect(quoteFormPropsMock.current).not.toBeNull();
    expect(screen.queryByText('Loading quotes...')).toBeNull();

    refreshDeferred.resolve({ data: [sentQuote] });
    await refresh;

    // Simulate returning to the list: only searchParams change, so the mounted
    // component fetches the list again and shows current membership and counts.
    navigationMocks.searchParams = 'tab=quotes&subtab=active';
    view.rerender(<QuotesTab />);

    await waitFor(() => expect(screen.getByText('No quotes in this category.')).toBeTruthy());
    expect(customTabsPropsMock.current?.tabs.find((tab) => tab.id === 'active')?.label).toBe('Active (0)');
    await waitFor(() =>
      expect(customTabsPropsMock.current?.tabs.find((tab) => tab.id === 'sent')?.label).toBe('Sent (1)'),
    );
  });

  it('updates the saved quote URL without a server navigation, retains the form, and refreshes on return to the list', async () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    navigationMocks.searchParams = 'tab=quotes&subtab=active';
    actionMocks.listQuotes.mockResolvedValueOnce({ data: [draftQuote] });
    const view = render(<QuotesTab />);
    await screen.findByText('Draft quote');

    navigationMocks.searchParams = 'tab=quotes&quoteId=new';
    view.rerender(<QuotesTab />);
    fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByText('Save test quote'));

    expect(pushState).toHaveBeenCalledWith(null, '', '/msp/billing?tab=quotes&quoteId=quote-created-1&mode=edit');
    expect(navigationMocks.push).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?tab=quotes&quoteId=quote-created-1&mode=edit');
    // Before useSearchParams updates, keep the form mounted and avoid
    // hidden-list server actions racing with the saved-quote transition.
    expect((screen.getByLabelText('Draft title') as HTMLInputElement).value).toBe('Keep this draft');
    expect(screen.queryByText('Loading quotes...')).toBeNull();
    expect(actionMocks.listQuotes).toHaveBeenCalledTimes(1);
    expect(getQuoteDocumentTemplatesMock).toHaveBeenCalledTimes(1);

    navigationMocks.searchParams = 'tab=quotes&quoteId=quote-created-1&mode=edit';
    view.rerender(<QuotesTab />);
    expect(screen.getByTestId('open-quote-id').textContent).toBe('quote-created-1');
    expect(actionMocks.listQuotes).toHaveBeenCalledTimes(1);

    actionMocks.listQuotes.mockResolvedValueOnce({ data: [{ ...draftQuote, title: 'Newly saved quote' }] });
    navigationMocks.searchParams = 'tab=quotes&subtab=active';
    view.rerender(<QuotesTab />);
    await screen.findByText('Newly saved quote');
    expect(actionMocks.listQuotes).toHaveBeenCalledTimes(2);
  });
});

describe('QuotesTab send dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.searchParams = 'subtab=active';
    quoteFormPropsMock.current = null;
    actionMocks.listQuotes.mockResolvedValue({ data: [draftQuote] });
    getQuoteDocumentTemplatesMock.mockResolvedValue([]);
    actionMocks.sendQuote.mockResolvedValue({});
    senderActionMocks.listSelectableSenders.mockResolvedValue({ senders: [], effectiveSenderAddress: '' });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the shared dialog with the row client id and sends merged recipients for the row quote', async () => {
    render(<QuotesTab />);

    const sendItem = await waitFor(() => {
      const item = document.getElementById(`send-quote-${draftQuote.quote_id}-menu-item`);
      expect(item).not.toBeNull();
      return item as HTMLElement;
    });
    fireEvent.click(sendItem);

    const recipientsField = await screen.findByTestId('field-send-quote-recipients');
    expect(recipientsField.getAttribute('data-client-id')).toBe(draftQuote.client_id);

    fireEvent.click(screen.getByText('Pick Contact'));
    fireEvent.change(document.getElementById('send-quote-additional-emails') as HTMLInputElement, {
      target: { value: 'contact@example.com, extra@example.com' },
    });
    fireEvent.click(document.getElementById('send-quote-confirm') as HTMLButtonElement);

    await waitFor(() => expect(actionMocks.sendQuote).toHaveBeenCalledWith(draftQuote.quote_id, {
      email_addresses: ['Contact@Example.com', 'extra@example.com'],
      message: undefined,
    }));
  });
});
