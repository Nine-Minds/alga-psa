// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ state: vi.fn(), preview: vi.fn(), purchase: vi.fn(), announce: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => (o?.defaultValue ?? (o ? `${k} ${Object.values(o).join(' ')}` : k)).replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) => String(o?.[key])) }),
  useFormatters: () => ({ formatCurrency: (n: number, c: string) => `${c} ${n.toFixed(2)}`, formatDate: (d: Date) => d.toISOString() }),
}));
vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoTile: ({ children, action }: any) => <section>{action}{children}</section>,
  BentoStat: ({ value, label }: any) => <span data-testid={`stat-${label}`}>{value}</span>,
}));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedPurchaseState: actions.state }));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', () => ({
  previewCoManagedSeatsAction: actions.preview, purchaseCoManagedSeatsAction: actions.purchase,
}));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>Pay in checkout</button>,
}));
vi.mock('@/components/co-managed/accessRefresh', () => ({ announceCoManagedAccessChanged: actions.announce, CO_MANAGED_ACCESS_CHANGED: 'x' }));

import CoManagedPoolEditor from '@/components/co-managed/CoManagedPoolEditor';

const purchase = (over: Record<string, unknown> = {}) => ({
  pending: null, awaitingVerification: null, minimumQuantity: 1, canPurchase: true, canResume: false, reason: 'available', ...over });
const pool = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({
  capacity: 0, allocated: 0, available: 0, canGrow: false, isReadOnly: true, graceEndsAt: null, selfHosted: false,
  purchase: purchase(p), ...over });

beforeEach(() => {
  actions.state.mockReset().mockResolvedValue(pool());
  actions.preview.mockReset().mockResolvedValue({ kind: 'quote', unitAmount: 1149, monthlyTotal: 3447, amountDue: 3447, currency: 'eur', offerRef: 'reviewed-offer' });
  actions.purchase.mockReset(); actions.announce.mockReset();
});
afterEach(cleanup);

describe('pool editor: first co-managed purchase', () => {
  it('zero seats: offers Buy co-managed seats at a minimum of one, and the review prices the configured currency', async () => {
    render(<CoManagedPoolEditor showTotals />);
    const input = await screen.findByLabelText('coManaged.quantity');
    expect(input).toHaveAttribute('min', '1');
    expect(screen.getAllByTestId(/stat-/).map((node) => node.textContent)).toEqual(['0', '0', '0']);
    const buy = screen.getByRole('button', { name: /Buy co-managed seats/ });
    fireEvent.change(input, { target: { value: '0' } });
    expect(buy).toBeDisabled();
    fireEvent.change(input, { target: { value: '3' } });
    expect(buy).toBeEnabled();
    fireEvent.click(buy);
    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith(3));
    expect(await screen.findByText(/coManaged\.dueNow eur 34\.47/)).toBeInTheDocument();
    expect(screen.getByText(/coManaged\.monthlyTotal 3 eur 34\.47/)).toBeInTheDocument();
    // Reviewing alone starts nothing.
    expect(actions.purchase).not.toHaveBeenCalled();
  });

  it.each([
    ['customer_unverified', 'We could not verify a Stripe billing account for this workspace. Contact support to have it linked.'],
    ['no_current_pro', 'Co-managed seats require a current Pro subscription. Check your subscription in Account Management.'],
    ['offer_paused', 'New seat purchases are paused. Contact your account manager for an update.'],
    ['misconfigured', 'The co-managed seat offer is not configured correctly. Contact support for help.'],
    ['temporarily_unavailable', 'Pricing is temporarily unavailable. Please try again shortly.'],
  ])('shows the next step for a failed quote (%s)', async (reason, message) => {
    actions.preview.mockResolvedValue({ kind: 'blocked', reason });
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.click(await screen.findByRole('button', { name: /Buy co-managed seats/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('coManaged.confirmPurchase')).not.toBeInTheDocument();
    expect(actions.purchase).not.toHaveBeenCalled();
  });

  it('shows the quote failure if refreshed terms cannot be priced', async () => {
    actions.purchase.mockResolvedValue({ kind: 'review_required' });
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.click(await screen.findByRole('button', { name: /Buy co-managed seats/ }));

    const confirm = await screen.findByText('coManaged.confirmPurchase');
    actions.preview.mockResolvedValueOnce({ kind: 'blocked', reason: 'no_current_pro' });
    fireEvent.click(confirm);

    expect(await screen.findByRole('alert')).toHaveTextContent('Co-managed seats require a current Pro subscription.');
    expect(screen.queryByText('coManaged.confirmPurchase')).not.toBeInTheDocument();

    // A later purchase attempt cannot reuse the terms from the successful first review.
    actions.preview.mockResolvedValueOnce({ kind: 'quote', unitAmount: 1200, monthlyTotal: 3600, amountDue: 3600, currency: 'eur', offerRef: 'fresh-offer' });
    fireEvent.click(screen.getByRole('button', { name: /Buy co-managed seats/ }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('coManaged.confirmPurchase')).toBeInTheDocument();
    fireEvent.click(screen.getByText('coManaged.confirmPurchase'));
    await waitFor(() => expect(actions.purchase).toHaveBeenCalledTimes(2));
    expect(actions.purchase).toHaveBeenLastCalledWith(expect.objectContaining({ offerRef: 'fresh-offer' }));
  });

  it('discards reviewed terms when a refresh unexpectedly rejects', async () => {
    actions.purchase.mockResolvedValue({ kind: 'review_required' });
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.click(await screen.findByRole('button', { name: /Buy co-managed seats/ }));

    actions.preview.mockRejectedValueOnce(new Error('private Stripe response detail'));
    fireEvent.click(await screen.findByText('coManaged.confirmPurchase'));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(2));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not price this change. Refresh and try again.');
    expect(screen.queryByText('coManaged.confirmPurchase')).not.toBeInTheDocument();

    actions.preview.mockResolvedValueOnce({ kind: 'quote', unitAmount: 1250, monthlyTotal: 3750, amountDue: 3750, currency: 'eur', offerRef: 'recovered-offer' });
    fireEvent.click(screen.getByRole('button', { name: /Buy co-managed seats/ }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(3));
    fireEvent.click(await screen.findByText('coManaged.confirmPurchase'));
    await waitFor(() => expect(actions.purchase).toHaveBeenCalledTimes(2));
    expect(actions.purchase).toHaveBeenLastCalledWith(expect.objectContaining({ offerRef: 'recovered-offer' }));
    expect(actions.purchase).not.toHaveBeenLastCalledWith(expect.objectContaining({ offerRef: 'reviewed-offer' }));
  });

  it('dismissing the review starts nothing and leaves the zero pool editable', async () => {
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.change(await screen.findByLabelText('coManaged.quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Buy co-managed seats/ }));
    const due = await screen.findByText(/coManaged\.dueNow/);
    fireEvent.keyDown(due, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByText(/coManaged\.dueNow/)).not.toBeInTheDocument());
    expect(actions.purchase).not.toHaveBeenCalled();
    expect(actions.announce).not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/stat-/).map((node) => node.textContent)).toEqual(['0', '0', '0']);
    expect(screen.getByLabelText('coManaged.quantity')).toBeEnabled();
  });

  it('confirming starts the existing purchase operation with the reviewed total', async () => {
    actions.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 's', clientSecret: 'c', publishableKey: 'pk' });
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.change(await screen.findByLabelText('coManaged.quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Buy co-managed seats/ }));
    fireEvent.click(await screen.findByText('coManaged.confirmPurchase'));
    await waitFor(() => expect(actions.purchase).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3 })));
    expect(await screen.findByText('Pay in checkout')).toBeInTheDocument();
  });

  it('an existing pool keeps its own minimum (allocated seats) and the ordinary label', async () => {
    actions.state.mockResolvedValue(pool({ capacity: 6, allocated: 4, available: 2 }, { minimumQuantity: 4 }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByLabelText('coManaged.quantity')).toHaveAttribute('min', '4');
    expect(screen.queryByRole('button', { name: /Buy co-managed seats/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'coManaged.reviewPurchase' })).toBeInTheDocument();
  });

  it('in flight: recovers the original quantity through the same operation', async () => {
    actions.state.mockResolvedValue(pool({}, { pending: { operationId: 'o', quantity: 5, state: 'checkout' }, canPurchase: false, canResume: true, reason: 'pending' }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByText('A purchase of 5 seats is pending.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'coManaged.resumePurchase' })).toBeInTheDocument();
    expect(screen.queryByLabelText('coManaged.quantity')).not.toBeInTheDocument();
  });

  it('awaiting verification: says so, offers only a refresh, and no second purchase', async () => {
    actions.state.mockResolvedValue(pool({}, { awaitingVerification: { operationId: 'o', quantity: 3 }, canPurchase: false, reason: 'awaiting_verification' }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByText(/awaiting payment verification/)).toBeInTheDocument();
    expect(screen.queryByLabelText('coManaged.quantity')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buy co-managed seats/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'coManaged.resumePurchase' })).not.toBeInTheDocument();
    // Totals stay verified (zero): a status or a return never raises them.
    expect(screen.getAllByTestId(/stat-/).map((node) => node.textContent)).toEqual(['0', '0', '0']);
    actions.state.mockResolvedValue(pool({ capacity: 3, available: 3 }, { minimumQuantity: 0, canPurchase: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(screen.getAllByTestId(/stat-/).map((node) => node.textContent)).toEqual(['3', '0', '3']));
    // The verified change asks the server for a fresh access read.
    expect(actions.announce).toHaveBeenCalledTimes(1);
  });

  it('an expired checkout is handled by the existing controller and a retry is possible', async () => {
    actions.purchase.mockResolvedValue({ kind: 'expired', publishableKey: null });
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.change(await screen.findByLabelText('coManaged.quantity'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Buy co-managed seats/ }));
    fireEvent.click(await screen.findByText('coManaged.confirmPurchase'));
    expect(await screen.findByText('The checkout session expired. Review the purchase again.')).toBeInTheDocument();
    expect(screen.getByLabelText('coManaged.quantity')).toBeEnabled();
  });
});
