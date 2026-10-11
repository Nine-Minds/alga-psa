/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@alga-psa/email/senderActions', () => ({
  listSelectableSenders: vi.fn(async () => ({ senders: [], effectiveSenderId: null, effectiveSenderAddress: 'provider@example.test', effectiveSenderDisplayName: 'Provider', allowOverride: false })),
}));

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

const getQuoteMock = vi.fn();
const getQuoteConversionPreviewMock = vi.fn();
const convertQuoteToSalesOrderMock = vi.fn();
const listQuoteVersionsMock = vi.fn();
const getQuoteApprovalSettingsMock = vi.fn();
const getAllClientsForBillingMock = vi.fn();
const getAllContactsMock = vi.fn();
const markQuoteAcceptedMock = vi.fn();
const requestQuoteApprovalChangesMock = vi.fn();
const approveQuoteMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      let value: string = typeof opts === 'string' ? opts : (opts?.defaultValue ?? key);
      if (opts && typeof opts === 'object') {
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue') continue;
          value = value.split(`{{${k}}}`).join(String(v));
        }
      }
      return value;
    },
    i18n: { language: 'en' },
  }),
  useFormatters: () => ({
    formatCurrency: (amount: number) => `$${Number(amount).toFixed(2)}`,
    formatDate: (date: unknown) => String(date),
    formatNumber: (value: number) => String(value),
  }),
}));

vi.mock('@radix-ui/themes', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Box: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, footer, isOpen }: { children: React.ReactNode; footer?: React.ReactNode; isOpen?: boolean }) => (
    <div>{children}{isOpen ? footer : null}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/LoadingIndicator', () => ({
  default: ({ text }: { text?: string }) => <div>{text ?? 'Loading...'}</div>,
}));

vi.mock('../../src/components/billing-dashboard/quotes/QuoteStatusBadge', () => ({
  default: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('../../src/actions/billingClientsActions', () => ({
  getAllClientsForBilling: (...args: any[]) => getAllClientsForBillingMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions/contactQueryActions', () => ({
  getContactsForPicker: (...args: any[]) => getAllContactsMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getAllUsersBasic: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@alga-psa/inventory/actions/salesOrderLinkActions', () => ({
  getSalesOrderForQuote: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/inventory/actions/availabilityActions', () => ({
  getProductAvailability: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/actions/quoteRecipientActions', () => ({
  getQuoteRecipientContacts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplates: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/actions/quoteActions', () => ({
  approveQuote: (...args: any[]) => approveQuoteMock(...args),
  markQuoteAccepted: (...args: any[]) => markQuoteAcceptedMock(...args),
  convertQuoteToContract: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  convertQuoteToSalesOrder: (...args: any[]) => convertQuoteToSalesOrderMock(...args),
  createQuoteRevision: vi.fn(),
  deleteQuote: vi.fn(),
  downloadQuotePdf: vi.fn(),
  duplicateQuote: vi.fn(),
  getQuote: (...args: any[]) => getQuoteMock(...args),
  getQuoteApprovalSettings: (...args: any[]) => getQuoteApprovalSettingsMock(...args),
  getQuoteConversionPreview: (...args: any[]) => getQuoteConversionPreviewMock(...args),
  listQuoteVersions: (...args: any[]) => listQuoteVersionsMock(...args),
  renderQuotePreview: vi.fn(),
  requestQuoteApprovalChanges: (...args: any[]) => requestQuoteApprovalChangesMock(...args),
  resendQuote: vi.fn(),
  saveQuoteAsTemplate: vi.fn(),
  sendQuote: vi.fn(),
  sendQuoteReminder: vi.fn(),
  submitQuoteForApproval: vi.fn(),
  updateQuote: vi.fn(),
}));

describe('QuoteDetail accepted optional item review state', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

    getQuoteMock.mockResolvedValue({
      quote_id: 'quote-accepted-1',
      quote_number: 'Q-0042',
      version: 1,
      client_id: 'client-1',
      contact_id: 'contact-1',
      title: 'Managed Services Renewal',
      description: 'Renewal scope',
      quote_date: '2026-03-10T00:00:00.000Z',
      valid_until: '2026-03-25T00:00:00.000Z',
      status: 'accepted',
      currency_code: 'USD',
      subtotal: 15000,
      discount_total: 0,
      tax: 0,
      total_amount: 15000,
      client_notes: 'Please review the options.',
      terms_and_conditions: 'Net 30',
      internal_notes: 'Internal review note',
      quote_items: [
        {
          quote_item_id: 'item-selected',
          description: 'Optional security bundle',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
          is_optional: true,
          is_selected: true,
          is_recurring: false,
          is_discount: false,
          billing_method: 'fixed',
          service_name: 'Security Bundle',
          service_sku: 'SEC-1',
        },
        {
          quote_item_id: 'item-declined',
          description: 'Optional onboarding workshop',
          quantity: 1,
          unit_price: 3000,
          total_price: 3000,
          is_optional: true,
          is_selected: false,
          is_recurring: false,
          is_discount: false,
          billing_method: 'fixed',
          service_name: 'Workshop',
          service_sku: 'WS-1',
        },
        {
          quote_item_id: 'item-required',
          description: 'Core managed services',
          quantity: 1,
          unit_price: 7000,
          total_price: 7000,
          is_optional: false,
          is_selected: true,
          is_recurring: true,
          billing_frequency: 'monthly',
          is_discount: false,
          billing_method: 'fixed',
          service_name: 'Managed Services',
          service_sku: 'MS-1',
        },
      ],
      activities: [],
    });
    listQuoteVersionsMock.mockResolvedValue([]);
    getQuoteApprovalSettingsMock.mockResolvedValue({ approvalRequired: false });
    getAllClientsForBillingMock.mockResolvedValue([
      { client_id: 'client-1', client_name: 'Acme Co' },
    ]);
    getAllContactsMock.mockResolvedValue([
      { contact_name_id: 'contact-1', full_name: 'Taylor Client', email: 'taylor@example.com' },
    ]);
  });

  it('T098a: accepted quote review shows selected and declined optional-item highlights for MSP conversion review', async () => {
    const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;

    render(<QuoteDetail quoteId="quote-accepted-1" onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);

    await waitFor(() => expect(getQuoteMock).toHaveBeenCalledWith('quote-accepted-1'));

    expect(await screen.findByText('Client Configuration Submitted')).toBeTruthy();
    expect(screen.getByText('Review the optional line items below before converting this quote. Selected items are marked as included, and declined items are highlighted for follow-up.')).toBeTruthy();
    expect(screen.getByText('Client selected this optional item')).toBeTruthy();
    expect(screen.getByText('Client declined this optional item')).toBeTruthy();
    expect(screen.getByText('Optional security bundle')).toBeTruthy();
    expect(screen.getByText('Optional onboarding workshop')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revise' })).toBeTruthy();
  });

  it.each(['rejected', 'expired', 'cancelled'] as const)(
    'T098b: %s quote detail shows a Revise action',
    async (status) => {
      getQuoteMock.mockResolvedValueOnce({
        quote_id: `quote-${status}-1`,
        quote_number: 'Q-0043',
        version: 1,
        client_id: 'client-1',
        title: `${status} quote`,
        quote_date: '2026-03-10T00:00:00.000Z',
        valid_until: '2026-03-25T00:00:00.000Z',
        status,
        currency_code: 'USD',
        subtotal: 10000,
        discount_total: 0,
        tax: 0,
        total_amount: 10000,
        quote_items: [],
        activities: [],
      });

      const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;
      render(<QuoteDetail quoteId={`quote-${status}-1`} onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);

      expect(await screen.findByRole('button', { name: 'Revise' })).toBeTruthy();
    },
  );

  it('T118: converted quotes show links to the created contract and invoice on the detail view', async () => {
    getQuoteMock.mockResolvedValueOnce({
      quote_id: 'quote-converted-1',
      quote_number: 'Q-0099',
      version: 1,
      client_id: 'client-1',
      contact_id: 'contact-1',
      title: 'Converted quote',
      description: 'Converted scope',
      quote_date: '2026-03-10T00:00:00.000Z',
      valid_until: '2026-03-25T00:00:00.000Z',
      status: 'converted',
      currency_code: 'USD',
      subtotal: 15000,
      discount_total: 0,
      tax: 0,
      total_amount: 15000,
      converted_contract_id: 'contract-123',
      converted_invoice_id: 'invoice-456',
      quote_items: [],
      activities: [],
    });

    const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;

    render(<QuoteDetail quoteId="quote-converted-1" onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);

    await waitFor(() => expect(getQuoteMock).toHaveBeenCalledWith('quote-converted-1'));

    expect(await screen.findByText('Open Converted Contract')).toBeTruthy();
    expect(screen.getByText('Open Converted Invoice')).toBeTruthy();
  });

  it('conversion dialog offers only the actions the preview allows, with sales order as the default path', async () => {
    getQuoteConversionPreviewMock.mockResolvedValue({
      quote_id: 'quote-accepted-1',
      available_actions: ['contract', 'invoice'],
      contract_items: [{ quote_item_id: 'item-required', description: 'Core managed services', quantity: 1, unit_price: 7000, total_price: 7000, is_optional: false, is_selected: true, is_recurring: true, target: 'contract' }],
      invoice_items: [{ quote_item_id: 'item-selected', description: 'Optional security bundle', quantity: 1, unit_price: 5000, total_price: 5000, is_optional: true, is_selected: true, is_recurring: false, target: 'invoice' }],
      sales_order_items: [{ quote_item_id: 'item-selected', description: 'Optional security bundle', quantity: 1, unit_price: 5000, total_price: 5000, is_optional: true, is_selected: true, is_recurring: false, target: 'sales_order' }],
      excluded_items: [],
      existing_sales_order: null,
    });

    const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;
    render(<QuoteDetail quoteId="quote-accepted-1" onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);
    await waitFor(() => expect(getQuoteMock).toHaveBeenCalledWith('quote-accepted-1'));

    (await screen.findByText('Convert to…')).click();
    await waitFor(() => expect(getQuoteConversionPreviewMock).toHaveBeenCalled());

    expect(await screen.findByText('Create Sales Order')).toBeTruthy();
    expect(screen.getByText('Create Draft Contract')).toBeTruthy();
    // Invoice competes with the sales-order path for the same product lines,
    // so it renders as the secondary (outline) action.
    const invoiceButton = screen.getByText('Create Draft Invoice').closest('button');
    expect(invoiceButton?.getAttribute('variant')).toBe('outline');
    // "Create Both Records" is gone: it created two records without saying which.
    expect(screen.queryByText('Create Both Records')).toBeNull();
  });

  it('conversion dialog hides Create Sales Order once a sales order exists', async () => {
    getQuoteConversionPreviewMock.mockResolvedValue({
      quote_id: 'quote-accepted-1',
      available_actions: ['contract'],
      contract_items: [{ quote_item_id: 'item-required', description: 'Core managed services', quantity: 1, unit_price: 7000, total_price: 7000, is_optional: false, is_selected: true, is_recurring: true, target: 'contract' }],
      invoice_items: [],
      sales_order_items: [{ quote_item_id: 'item-selected', description: 'Optional security bundle', quantity: 1, unit_price: 5000, total_price: 5000, is_optional: true, is_selected: true, is_recurring: false, target: 'sales_order' }],
      excluded_items: [],
      existing_sales_order: { so_id: 'so-1', so_number: 'SO00001' },
    });

    const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;
    render(<QuoteDetail quoteId="quote-accepted-1" onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);
    await waitFor(() => expect(getQuoteMock).toHaveBeenCalledWith('quote-accepted-1'));

    (await screen.findByText('Convert to…')).click();
    await waitFor(() => expect(getQuoteConversionPreviewMock).toHaveBeenCalled());

    expect(await screen.findByText('On Sales Order SO00001')).toBeTruthy();
    expect(screen.queryByText('Create Sales Order')).toBeNull();
    expect(screen.queryByText('Create Draft Invoice')).toBeNull();
    expect(screen.getByText('Create Draft Contract')).toBeTruthy();
  });

  it('T010: quote detail formats minor-unit summary amounts at one-hundredth magnitude', async () => {
    getQuoteMock.mockResolvedValueOnce({
      quote_id: 'quote-money-1',
      quote_number: 'Q-0100',
      version: 1,
      client_id: 'client-1',
      contact_id: null,
      title: 'Currency magnitude',
      description: null,
      quote_date: '2026-03-10T00:00:00.000Z',
      valid_until: '2026-03-25T00:00:00.000Z',
      status: 'draft',
      currency_code: 'AUD',
      subtotal: 12345,
      discount_total: 2345,
      tax: 678,
      total_amount: 10678,
      quote_items: [],
      activities: [],
    });

    const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;
    render(<QuoteDetail quoteId="quote-money-1" onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);

    await waitFor(() => expect(getQuoteMock).toHaveBeenCalledWith('quote-money-1'));

    // 12,345 minor units must render as 123.45 — not 12,345.00.
    expect(await screen.findByText('$123.45')).toBeTruthy();
    expect(screen.getByText('$23.45')).toBeTruthy();
    expect(screen.getByText('$6.78')).toBeTruthy();
    // Total renders in both the header summary and the totals grid.
    expect(screen.getAllByText('$106.78').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('$12345.00')).toBeNull();
  });
});


// alga-2026-0002597: sole-approver notice, Request Changes from the UI, MSP "Mark as accepted".
describe('QuoteDetail approval + mark-accepted workflow', () => {
  const buildQuote = (status: string) => ({
    quote_id: 'quote-wf-1',
    quote_number: 'Q-0100',
    version: 1,
    client_id: 'client-1',
    title: 'Workflow quote',
    quote_date: '2026-03-10T00:00:00.000Z',
    valid_until: '2026-03-25T00:00:00.000Z',
    status,
    currency_code: 'USD',
    subtotal: 10000,
    discount_total: 0,
    tax: 0,
    total_amount: 10000,
    quote_items: [],
    activities: [],
  });

  const renderDetail = async (status: string, settings: Record<string, unknown>) => {
    getQuoteMock.mockResolvedValue(buildQuote(status));
    getQuoteApprovalSettingsMock.mockResolvedValue(settings);
    const QuoteDetail = (await import('../../src/components/billing-dashboard/quotes/QuoteDetail')).default;
    render(<QuoteDetail quoteId="quote-wf-1" onBack={vi.fn()} onEdit={vi.fn()} onSelectVersion={vi.fn()} />);
    await waitFor(() => expect(getQuoteMock).toHaveBeenCalledWith('quote-wf-1'));
  };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    listQuoteVersionsMock.mockResolvedValue([]);
    getAllClientsForBillingMock.mockResolvedValue([{ client_id: 'client-1', client_name: 'Acme Co' }]);
    getAllContactsMock.mockResolvedValue([]);
  });

  it('tells the only approver they can approve their own pending quote (never looks stuck)', async () => {
    await renderDetail('pending_approval', { approvalRequired: true, currentUserIsSoleApprover: true });

    expect(await screen.findByText('You are the only quote approver')).toBeTruthy();
    expect(screen.getByText(/you can approve this quote yourself/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('shows the sole-approver notice on a draft when approval is required', async () => {
    await renderDetail('draft', { approvalRequired: true, currentUserIsSoleApprover: true });
    expect(await screen.findByText('You are the only quote approver')).toBeTruthy();
    expect(screen.getByText(/you can approve it yourself and then send it/i)).toBeTruthy();
  });

  it('does not show the sole-approver notice when another approver exists or approval is off', async () => {
    await renderDetail('pending_approval', { approvalRequired: true, currentUserIsSoleApprover: false });
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.queryByText('You are the only quote approver')).toBeNull();
  });

  it('Request Changes from the UI sends the comment to the action, returns the quote to draft and blocks an empty comment', async () => {
    requestQuoteApprovalChangesMock.mockResolvedValue({ ...buildQuote('draft') });
    await renderDetail('pending_approval', { approvalRequired: true, currentUserIsSoleApprover: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Request Changes' }));
    const confirmButton = document.getElementById('quote-approval-confirm') as HTMLButtonElement;
    expect(confirmButton).toBeTruthy();
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Describe the changes needed...'), { target: { value: 'Lower the rate' } });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(requestQuoteApprovalChangesMock).toHaveBeenCalledWith('quote-wf-1', 'Lower the rate'));
    expect(await screen.findByText('Quote returned to draft with requested changes.')).toBeTruthy();
  });

  it('surfaces a Request Changes failure instead of failing silently', async () => {
    requestQuoteApprovalChangesMock.mockResolvedValue({ permissionError: 'Permission denied: Cannot approve quotes' });
    await renderDetail('pending_approval', { approvalRequired: true, currentUserIsSoleApprover: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Request Changes' }));
    fireEvent.change(await screen.findByPlaceholderText('Describe the changes needed...'), { target: { value: 'x' } });
    fireEvent.click(document.getElementById('quote-approval-confirm') as HTMLButtonElement);

    expect(await screen.findByText('Permission denied: Cannot approve quotes')).toBeTruthy();
  });

  it('offers Mark as accepted on a sent quote and records the optional note', async () => {
    markQuoteAcceptedMock.mockResolvedValue({ ...buildQuote('accepted') });
    await renderDetail('sent', { approvalRequired: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Mark as accepted' }));
    fireEvent.change(await screen.findByPlaceholderText('For example: Accepted by email on the 3rd'), { target: { value: 'Phone OK' } });
    fireEvent.click(document.getElementById('quote-mark-accepted-confirm') as HTMLButtonElement);

    await waitFor(() => expect(markQuoteAcceptedMock).toHaveBeenCalledWith('quote-wf-1', 'Phone OK'));
    expect(await screen.findByText('Quote marked as accepted.')).toBeTruthy();
  });

  it.each(['draft', 'pending_approval', 'approved', 'accepted', 'rejected'])(
    'does not offer Mark as accepted on a %s quote',
    async (status) => {
      await renderDetail(status, { approvalRequired: false });
      await waitFor(() => expect(document.getElementById('quote-detail-mark-accepted')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Mark as accepted' })).toBeNull();
    },
  );
});
