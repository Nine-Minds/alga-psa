// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Why is this invoice going to the parent's inbox?" is only answerable if the
 * dialog says which profile the invoice bills. The address comes from the
 * invoice's profile when it carries one, so naming that profile — including
 * the case where the invoice carries none and falls back to the client default
 * — is what separates a right address from a surprising one.
 *
 * An unsegmented client never had a profile decision to make and must not be
 * shown one (D6).
 */

const mocks = vi.hoisted(() => ({
  getInvoiceEmailRecipientAction: vi.fn(),
  sendInvoiceEmailAction: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceJobActions', () => ({
  getInvoiceEmailRecipientAction: mocks.getInvoiceEmailRecipientAction,
  sendInvoiceEmailAction: mocks.sendInvoiceEmailAction,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, footer }: any) =>
    isOpen ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const fallback = (options?.defaultValue as string) ?? key;
      return fallback.replace(/{{(\w+)}}/g, (_match, token) => String(options?.[token] ?? ''));
    },
  }),
}));

const { SendInvoiceEmailDialog } = await import('./SendInvoiceEmailDialog');

const recipient = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: 'invoice-1',
  invoiceNumber: '12345',
  clientName: 'Northstar Dental Group',
  recipientEmail: 'natallia+12345@nineminds.com',
  recipientName: 'Northstar Dental Group',
  recipientSource: 'profile_billing_email',
  totalAmount: '$25,000.00',
  currencyCode: 'USD',
  dueDate: null,
  invoiceDate: null,
  billingProfileName: '12345',
  clientHasMultipleBillingProfiles: true,
  companyName: 'Oz',
  fromEmail: 'info@nineminds.com',
  ...overrides,
});

const renderDialog = () =>
  render(
    <SendInvoiceEmailDialog
      isOpen
      onClose={() => {}}
      invoiceIds={['invoice-1']}
    />,
  );

describe('send invoice email — the profile the address came from', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('names the profile an invoice bills', async () => {
    mocks.getInvoiceEmailRecipientAction.mockResolvedValue({
      recipients: [recipient()],
      errors: [],
    });

    renderDialog();

    await waitFor(() => expect(screen.getByText('Billing profile: 12345')).toBeTruthy());
    expect(screen.getByText('<natallia+12345@nineminds.com>')).toBeTruthy();
  });

  it('says the client default when the invoice carries no profile', async () => {
    mocks.getInvoiceEmailRecipientAction.mockResolvedValue({
      recipients: [
        recipient({
          billingProfileName: null,
          recipientSource: 'billing_email',
          recipientEmail: 'it-ops@northstardental.example',
        }),
      ],
      errors: [],
    });

    renderDialog();

    await waitFor(() =>
      expect(screen.getByText("Billing profile: the client's default profile")).toBeTruthy());
  });

  it('shows no profile line for a client that holds a single profile', async () => {
    mocks.getInvoiceEmailRecipientAction.mockResolvedValue({
      recipients: [recipient({ clientHasMultipleBillingProfiles: false })],
      errors: [],
    });

    renderDialog();

    await waitFor(() => expect(screen.getByText('<natallia+12345@nineminds.com>')).toBeTruthy());
    expect(screen.queryByText(/Billing profile:/)).toBeNull();
  });
});
