/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
};

const getQuoteMock = vi.fn();
const listQuoteVersionsMock = vi.fn();
const getQuoteApprovalSettingsMock = vi.fn();
const getAllClientsForBillingMock = vi.fn();
const getAllContactsMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
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
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

vi.mock('@alga-psa/clients/actions', () => ({
  getAllContacts: (...args: any[]) => getAllContactsMock(...args),
}));

vi.mock('../../src/actions/quoteActions', () => ({
  approveQuote: vi.fn(),
  convertQuoteToBoth: vi.fn(),
  convertQuoteToContract: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  deleteQuote: vi.fn(),
  duplicateQuote: vi.fn(),
  getQuote: (...args: any[]) => getQuoteMock(...args),
  getQuoteApprovalSettings: (...args: any[]) => getQuoteApprovalSettingsMock(...args),
  getQuoteConversionPreview: vi.fn(),
  listQuoteVersions: (...args: any[]) => listQuoteVersionsMock(...args),
  requestQuoteApprovalChanges: vi.fn(),
  resendQuote: vi.fn(),
  saveQuoteAsTemplate: vi.fn(),
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
  });

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
});
