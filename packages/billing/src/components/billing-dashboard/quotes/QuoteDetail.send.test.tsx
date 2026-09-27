// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sharedDialogProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
  useFormatters: () => ({
    formatCurrency: (value: number) => `$${value}`,
    formatDate: (value: string) => value,
  }),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  QuoteTermsContent: () => null,
}));

vi.mock('../../../actions/billingClientsActions', () => ({
  getAllClientsForBilling: vi.fn(),
}));
vi.mock('../../../actions/billingClientLocationActions', () => ({
  getActiveClientLocationsForBilling: vi.fn(),
}));
vi.mock('../../../actions/quoteDocumentTemplates', () => ({
  getQuoteDocumentTemplates: vi.fn(),
}));
vi.mock('@alga-psa/user-composition/actions/contactQueryActions', () => ({
  getContactsForPicker: vi.fn(),
}));
vi.mock('@alga-psa/inventory/actions/salesOrderLinkActions', () => ({
  getSalesOrderForQuote: vi.fn(),
}));
vi.mock('@alga-psa/inventory/actions/availabilityActions', () => ({
  getProductAvailability: vi.fn(),
}));

const quoteActionMocks = vi.hoisted(() => ({
  approveQuote: vi.fn(),
  convertQuoteToContract: vi.fn(),
  convertQuoteToInvoice: vi.fn(),
  convertQuoteToSalesOrder: vi.fn(),
  createQuoteRevision: vi.fn(),
  deleteQuote: vi.fn(),
  downloadQuotePdf: vi.fn(),
  duplicateQuote: vi.fn(),
  getQuote: vi.fn(),
  getQuoteApprovalSettings: vi.fn(),
  getQuoteConversionPreview: vi.fn(),
  listQuoteVersions: vi.fn(),
  renderQuotePreview: vi.fn(),
  requestQuoteApprovalChanges: vi.fn(),
  resendQuote: vi.fn(),
  saveQuoteAsTemplate: vi.fn(),
  sendQuote: vi.fn(),
  sendQuoteReminder: vi.fn(),
  submitQuoteForApproval: vi.fn(),
  updateQuote: vi.fn(),
}));

vi.mock('../../../actions/quoteActions', () => quoteActionMocks);

vi.mock('./QuoteSendDialog', () => ({
  QuoteSendDialog: (props: {
    isOpen: boolean;
    clientId?: string | null;
    onConfirm: (payload: { email_addresses?: string[]; message?: string }) => void;
  }) => {
    sharedDialogProps.current = props as unknown as Record<string, unknown>;
    if (!props.isOpen) return null;
    return (
      <button
        type="button"
        onClick={() => props.onConfirm({ email_addresses: ['picked@example.com'], message: 'hello' })}
      >
        confirm shared send
      </button>
    );
  },
}));

vi.mock('./QuoteStatusBadge', () => ({ default: () => null }));

import QuoteDetail from './QuoteDetail';
import { getAllClientsForBilling } from '../../../actions/billingClientsActions';
import { getActiveClientLocationsForBilling } from '../../../actions/billingClientLocationActions';
import { getQuoteDocumentTemplates } from '../../../actions/quoteDocumentTemplates';
import { getContactsForPicker } from '@alga-psa/user-composition/actions/contactQueryActions';
import { getSalesOrderForQuote } from '@alga-psa/inventory/actions/salesOrderLinkActions';
import { getProductAvailability } from '@alga-psa/inventory/actions/availabilityActions';

const draftQuote = {
  quote_id: 'quote-1',
  client_id: 'client-1',
  contact_id: 'contact-1',
  status: 'draft',
  title: 'Test quote',
  quote_number: 'Q-1',
  version: 1,
  quote_date: '2026-01-01',
  valid_until: '2026-02-01',
  po_number: null,
  currency_code: 'USD',
  subtotal: 100,
  discount_total: 0,
  tax: 0,
  total_amount: 100,
  quote_items: [],
  is_template: false,
  template_id: null,
};

describe('QuoteDetail send dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sharedDialogProps.current = null;
    vi.mocked(getAllClientsForBilling).mockResolvedValue([{ client_id: 'client-1', client_name: 'Acme' }] as never);
    vi.mocked(getContactsForPicker).mockResolvedValue([{ contact_name_id: 'contact-1', full_name: 'Jane' }] as never);
    vi.mocked(getActiveClientLocationsForBilling).mockResolvedValue([] as never);
    vi.mocked(getSalesOrderForQuote).mockResolvedValue(null as never);
    vi.mocked(getProductAvailability).mockResolvedValue([] as never);
    vi.mocked(getQuoteDocumentTemplates).mockResolvedValue([] as never);
    quoteActionMocks.getQuote.mockResolvedValue(draftQuote);
    quoteActionMocks.getQuoteApprovalSettings.mockResolvedValue({ approvalRequired: false });
    quoteActionMocks.listQuoteVersions.mockResolvedValue([draftQuote]);
    quoteActionMocks.sendQuote.mockResolvedValue(draftQuote);
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the shared dialog with the loaded quote client and forwards its payload to sendQuote', async () => {
    render(<QuoteDetail quoteId="quote-1" onBack={vi.fn()} onEdit={vi.fn()} />);

    fireEvent.click(await screen.findByText('Send to Client'));

    await waitFor(() => expect(sharedDialogProps.current).not.toBeNull());
    expect(sharedDialogProps.current).toMatchObject({
      isOpen: true,
      clientId: 'client-1',
    });

    fireEvent.click(screen.getByText('confirm shared send'));

    await waitFor(() => expect(quoteActionMocks.sendQuote).toHaveBeenCalledWith('quote-1', {
      email_addresses: ['picked@example.com'],
      message: 'hello',
    }));
  });
});
