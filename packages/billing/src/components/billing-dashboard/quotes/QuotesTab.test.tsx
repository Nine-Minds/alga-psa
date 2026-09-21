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

describe('QuotesTab sent quote actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.searchParams = 'subtab=sent';
    quoteFormPropsMock.current = null;
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
});

const draftQuote = {
  quote_id: 'quote-draft-1',
  client_id: 'client-draft-1',
  client_name: 'Draft Client',
  currency_code: 'USD',
  display_quote_number: 'Q-2001',
  quote_date: '2026-08-21',
  status: 'draft',
  title: 'Draft quote',
  total_amount: 5000,
};

describe('QuotesTab send dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.searchParams = 'subtab=active';
    quoteFormPropsMock.current = null;
    actionMocks.listQuotes.mockResolvedValue({ data: [draftQuote] });
    getQuoteDocumentTemplatesMock.mockResolvedValue([]);
    actionMocks.sendQuote.mockResolvedValue({});
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
