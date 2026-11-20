// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({
  enable: vi.fn(), options: vi.fn(), choices: vi.fn(), state: vi.fn(), preview: vi.fn(), purchase: vi.fn(),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? (o ? `${_k} ${Object.values(o).join(' ')}` : _k)).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatCurrency: (n: number, c: string) => `${c} ${n.toFixed(2)}`, formatDate: (d: Date) => d.toISOString() }),
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  enableCoManagedSeatArrangementAction: actions.enable, getCoManagedSeatAdminOptions: actions.options,
  getCoManagedSeatContactChoicesAction: actions.choices,
}));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedPurchaseState: actions.state }));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', () => ({
  previewCoManagedSeatsAction: actions.preview, purchaseCoManagedSeatsAction: actions.purchase,
}));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => <button onClick={onComplete}>Pay in checkout</button>,
}));

import { QuickAddClientProvider } from '@alga-psa/ui/context/QuickAddClientContext';
import CoManagedShapeChooser from '@/components/co-managed/CoManagedShapeChooser';

const callbacks = {
  renderQuickAddClient: () => null, renderQuickAddInteraction: () => null, openInteractionDetails: async () => undefined,
  renderQuickAddContact: () => null,
};
const pool = (purchased: number, available: number, pending: any = null) => ({
  capacity: purchased, allocated: purchased - available, available, selfHosted: false,
  purchase: { pending, canPurchase: !pending, canResume: Boolean(pending), reason: pending ? 'pending' : 'available' },
});
const mount = (available: number, onEnabled = vi.fn()) => render(
  <QuickAddClientProvider value={callbacks}>
    <CoManagedShapeChooser clientId="c1" idPrefix="t" purchaseOpen workspaceSetup={null} onEnabled={onEnabled}
      enable={{ capacity: { purchased: 4, allocated: 4 - available, available }, blocker: available < 1 ? 'CAPACITY_UNAVAILABLE' : null }} />
  </QuickAddClientProvider>);
const fill = async (seats: string) => {
  fireEvent.click(screen.getByRole('radio', { name: /Seat/ }));
  await waitFor(() => expect(screen.getByLabelText('Service desk')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Number of seats'), { target: { value: seats } });
  fireEvent.click(screen.getByLabelText('Service desk'));
  fireEvent.click(await screen.findByRole('button', { name: 'Choose a contact' }));
  fireEvent.click(await screen.findByRole('option', { name: /Dana Reyes/ }));
};
const created = { created: true, scopeSet: true, invited: true, delivered: true, followUpError: null };

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.choices.mockResolvedValue([{ contactId: 'c-dana', name: 'Dana Reyes', email: 'dana@example.test', blocker: null }]);
  actions.options.mockResolvedValue({ boards: [{ boardId: 'b1', name: 'Service desk' }], projects: [], staff: [] });
  actions.preview.mockImplementation(async (quantity: number) => ({ unitAmount: 1000, monthlyTotal: 1000 * quantity, amountDue: 3000, currency: 'EUR' }));
});
afterEach(cleanup);

describe('short capacity from the seat setup (F087)', () => {
  it('reviews a purchase for the new total, then completes the allocation after one purchase', async () => {
    // Pool: 4 purchased, 2 available. Asking for 5 is 3 short: the new total is 7.
    actions.state
      .mockResolvedValueOnce(pool(4, 2))                       // advance(): decide review
      .mockResolvedValueOnce(pool(7, 5))                       // after checkout: capacity covers
    actions.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 's', clientSecret: 'cs', publishableKey: 'pk' });
    actions.enable.mockResolvedValue(created);
    const onEnabled = vi.fn();
    mount(2, onEnabled);
    await fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));

    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith(7));
    expect(actions.enable).not.toHaveBeenCalled();
    expect(await screen.findByText(/EUR 30\.00/)).toBeInTheDocument();      // due now, in the price's currency
    expect(screen.getByText(/EUR 70\.00/)).toBeInTheDocument();             // monthly total for 7 seats

    fireEvent.click(screen.getByRole('button', { name: 'coManaged.confirmPurchase' }));
    await waitFor(() => expect(actions.purchase).toHaveBeenCalledTimes(1));
    expect(actions.purchase.mock.calls[0][0]).toMatchObject({ quantity: 7 });
    actions.purchase.mockResolvedValue({ kind: 'updated', subscriptionId: 'sub', publishableKey: null });
    fireEvent.click(await screen.findByText('Pay in checkout'));

    await waitFor(() => expect(actions.enable).toHaveBeenCalledTimes(1));
    expect(actions.enable.mock.calls[0][0]).toMatchObject({ clientId: 'c1', seats: 5, contactId: 'c-dana', boards: [{ boardId: 'b1', canCreate: false }] });
    await waitFor(() => expect(onEnabled).toHaveBeenCalled());
    // Two calls to the purchase action, one operation: the second replays the first.
    const operations = new Set(actions.purchase.mock.calls.map((call) => call[0].operationId));
    expect(operations.size).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it('shows a blocked quote after setup returns to idle, then clears it when the user retries', async () => {
    actions.state.mockResolvedValue(pool(4, 2));
    actions.preview.mockResolvedValue({ kind: 'blocked', reason: 'no_current_pro' });
    mount(2);
    await fill('5');
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Co-managed seats require a current Pro subscription. Check your subscription in Account Management.');

    let resolveRetry!: (value: ReturnType<typeof pool>) => void;
    actions.state.mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable seats' }));
    await waitFor(() => expect(actions.state).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    resolveRetry(pool(4, 2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Co-managed seats require a current Pro subscription.');
  });

  it('a reload after a paid purchase completes the allocation without a second purchase', async () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem('co-managed-seat-intent:c1', JSON.stringify({
      clientId: 'c1', operationId: '33333333-3333-4333-8333-333333333333', seats: 5, contactId: 'c-dana',
      boards: [{ boardId: 'b1', canCreate: false }], purchase: { operationId, quantity: 7 }, savedAt: Date.now() }));
    // Reconciliation has landed: the pool now covers the request and nothing is pending.
    actions.state.mockResolvedValue(pool(7, 5));
    actions.enable.mockResolvedValue(created);
    const onEnabled = vi.fn();
    mount(5, onEnabled);

    await waitFor(() => expect(actions.enable).toHaveBeenCalledTimes(1));
    expect(actions.enable.mock.calls[0][0]).toMatchObject({ operationId: '33333333-3333-4333-8333-333333333333', seats: 5 });
    expect(actions.purchase).not.toHaveBeenCalled();
    expect(actions.preview).not.toHaveBeenCalled();
    await waitFor(() => expect(onEnabled).toHaveBeenCalled());
  });

  it('returning before the webhook replays the same operation and waits; it never opens a new review', async () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem('co-managed-seat-intent:c1', JSON.stringify({
      clientId: 'c1', operationId: '33333333-3333-4333-8333-333333333333', seats: 5, contactId: 'c-dana',
      boards: [], purchase: { operationId, quantity: 7 }, savedAt: Date.now() }));
    actions.state.mockResolvedValue(pool(4, 2));            // capacity has not caught up
    actions.purchase.mockResolvedValue({ kind: 'updated', subscriptionId: 'sub', publishableKey: null });
    mount(2);

    expect(await screen.findByText(/Waiting for the purchase to complete/)).toBeInTheDocument();
    expect(actions.purchase).toHaveBeenCalledTimes(1);
    expect(actions.purchase.mock.calls[0][0]).toEqual({ operationId, quantity: 7 });
    expect(actions.enable).not.toHaveBeenCalled();
    expect(actions.preview).not.toHaveBeenCalled();
  });

  it('a pending checkout shows a waiting state and does not call purchase on its own', async () => {
    localStorage.setItem('co-managed-seat-intent:c1', JSON.stringify({
      clientId: 'c1', operationId: '33333333-3333-4333-8333-333333333333', seats: 5, contactId: 'c-dana',
      boards: [], purchase: null, savedAt: Date.now() }));
    actions.state.mockResolvedValue(pool(4, 2, { operationId: '22222222-2222-4222-8222-222222222222', quantity: 7, state: 'checkout' }));
    mount(2);
    expect(await screen.findByText(/Waiting for the purchase to complete/)).toBeInTheDocument();
    expect(actions.purchase).not.toHaveBeenCalled();
  });

  it('a failed payment offers to retry the same purchase', async () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem('co-managed-seat-intent:c1', JSON.stringify({
      clientId: 'c1', operationId: '33333333-3333-4333-8333-333333333333', seats: 5, contactId: 'c-dana',
      boards: [], purchase: { operationId, quantity: 7 }, savedAt: Date.now() }));
    actions.state.mockResolvedValue(pool(4, 2, { operationId, quantity: 7, state: 'payment_failed' }));
    actions.purchase.mockResolvedValue({ kind: 'checkout', sessionId: 's', clientSecret: 'cs', publishableKey: 'pk' });
    mount(2);
    expect(await screen.findByText(/Payment did not go through/)).toBeInTheDocument();
    expect(actions.purchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Resume purchase' }));
    await waitFor(() => expect(actions.purchase).toHaveBeenCalledTimes(1));
    expect(actions.purchase.mock.calls[0][0]).toEqual({ operationId, quantity: 7 });
  });

  it('an expired purchase is dropped and the review is offered again for the current total', async () => {
    const operationId = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem('co-managed-seat-intent:c1', JSON.stringify({
      clientId: 'c1', operationId: '33333333-3333-4333-8333-333333333333', seats: 5, contactId: 'c-dana',
      boards: [], purchase: { operationId, quantity: 7 }, savedAt: Date.now() }));
    actions.state.mockResolvedValue(pool(4, 2));
    actions.purchase.mockResolvedValue({ kind: 'expired', publishableKey: null });
    mount(2);
    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith(7));
    expect(actions.purchase).toHaveBeenCalledTimes(1);          // the replay only
    expect(actions.enable).not.toHaveBeenCalled();
  });
});
