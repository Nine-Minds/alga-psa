/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreditsSummaryCard from './CreditsSummaryCard';

const getClientCreditSummaryMock = vi.hoisted(() => vi.fn());
const getClientCreditHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
}));

vi.mock('../../actions/client-portal-actions/client-billing', () => ({
  getClientCreditSummary: (...args: unknown[]) => getClientCreditSummaryMock(...args),
  getClientCreditHistory: (...args: unknown[]) => getClientCreditHistoryMock(...args),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: ({ ...props }: any) => <div {...props}>loading</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children, ...props }: any) =>
    isOpen ? <div data-testid="dialog" {...props}>{children}</div> : null,
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

const formatCurrency = (amount: number, _currencyCode?: string) =>
  `${amount >= 0 ? '' : '-'}$${(Math.abs(amount) / 100).toFixed(2)}`;
const formatDate = (date: string | { toString(): string } | undefined | null) =>
  date ? String(date) : 'N/A';

function summaryWith(credits: any[]): any {
  return { available_credit: 50000, credits };
}

function activeCreditRow() {
  return {
    credit_id: 'credit-1',
    description: 'Prepayment credit',
    amount: 10000,
    remaining_amount: 5000,
    created_at: '2026-01-01',
    expiration_date: null,
    is_expired: false,
    currency_code: 'USD',
  };
}

describe('CreditsSummaryCard credit history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientCreditSummaryMock.mockResolvedValue(summaryWith([activeCreditRow()]));
    getClientCreditHistoryMock.mockResolvedValue([
      {
        transaction_id: 'tx-issuance',
        type: 'prepayment',
        description: null,
        amount: 10000,
        balance_after: 15000,
        created_at: '2026-07-01T10:00:00.000Z',
        invoice_id: 'inv-1',
        invoice_number: 'INV-001',
        currency_code: 'USD',
      },
      {
        transaction_id: 'tx-application',
        type: 'credit_application',
        description: null,
        amount: -5000,
        balance_after: 10000,
        created_at: '2026-07-05T10:00:00.000Z',
        invoice_id: 'inv-2',
        invoice_number: 'INV-002',
        currency_code: 'USD',
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it('T155: renders the history button and opens a ledger dialog listing rows', async () => {
    render(
      <CreditsSummaryCard formatCurrency={formatCurrency} formatDate={formatDate} />
    );

    const historyButton = await screen.findByRole('button', { name: /view history/i });
    expect(historyButton).toBeInTheDocument();

    fireEvent.click(historyButton);

    expect(await screen.findByText('Issued — prepayment #INV-001')).toBeInTheDocument();
    expect(screen.getByText('Applied to invoice #INV-002')).toBeInTheDocument();
    expect(screen.getByText('+$100.00')).toBeInTheDocument();
    expect(screen.getByText('−$50.00')).toBeInTheDocument();
    expect(screen.getByText('balance $150.00')).toBeInTheDocument();
    expect(getClientCreditHistoryMock).toHaveBeenCalledTimes(1);
  });

  it('T155a: credit_issuance rows (production prepayment finalization) keep their invoice reference', async () => {
    getClientCreditHistoryMock.mockResolvedValue([
      {
        transaction_id: 'tx-real-issuance',
        type: 'credit_issuance',
        description: null,
        amount: 12500,
        balance_after: 12500,
        created_at: '2026-07-10T10:00:00.000Z',
        invoice_id: 'inv-3',
        invoice_number: 'INV-003',
        currency_code: 'USD',
      },
      {
        transaction_id: 'tx-manual-issuance',
        type: 'credit_issuance',
        description: null,
        amount: 2500,
        balance_after: 15000,
        created_at: '2026-07-12T10:00:00.000Z',
        invoice_id: null,
        invoice_number: null,
        currency_code: 'USD',
      },
    ]);
    render(
      <CreditsSummaryCard formatCurrency={formatCurrency} formatDate={formatDate} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /view history/i }));

    expect(await screen.findByText('Issued — invoice #INV-003')).toBeInTheDocument();
    expect(screen.getByText('Issued')).toBeInTheDocument();
  });

  it('T156: empty history shows the empty state', async () => {
    getClientCreditHistoryMock.mockResolvedValue([]);
    render(
      <CreditsSummaryCard formatCurrency={formatCurrency} formatDate={formatDate} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /view history/i }));

    expect(await screen.findByText('No credit activity yet')).toBeInTheDocument();
  });

  it('T157: a history load error degrades to the dialog empty state', async () => {
    getClientCreditHistoryMock.mockResolvedValue({ permissionError: 'denied' });
    render(
      <CreditsSummaryCard formatCurrency={formatCurrency} formatDate={formatDate} />
    );

    fireEvent.click(await screen.findByRole('button', { name: /view history/i }));

    expect(await screen.findByText('No credit activity yet')).toBeInTheDocument();
  });

  it('T158: history errors never break the underlying credit card', async () => {
    getClientCreditHistoryMock.mockRejectedValue(new Error('boom'));
    render(
      <CreditsSummaryCard formatCurrency={formatCurrency} formatDate={formatDate} />
    );

    // 'Available Credit' renders even in the loading state, so wait on the
    // summary-driven line instead — it only appears once the credits load.
    expect(await screen.findByText('Prepayment credit')).toBeInTheDocument();
    expect(screen.getByText('Available Credit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view history/i }));

    expect(await screen.findByText('No credit activity yet')).toBeInTheDocument();
    expect(screen.getByText('Available Credit')).toBeInTheDocument();
  });
});
