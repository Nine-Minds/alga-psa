// @vitest-environment jsdom
import React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const actions = vi.hoisted(() => ({ state: vi.fn(), preview: vi.fn(), purchase: vi.fn(), announce: vi.fn() }));
// A stable `t`, as in the app: the editor reloads when `t` changes, so a fresh one per render would reset the quantity.
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (k: string, o?: any) => (o?.defaultValue ?? (o ? `${k} ${Object.values(o).join(' ')}` : k)).replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) => String(o?.[key]));
  const translation = { t };
  const formatters = { formatCurrency: (n: number, c: string) => `${c} ${n.toFixed(2)}`, formatDate: (d: Date) => d.toISOString() };
  return { useTranslation: () => translation, useFormatters: () => formatters };
});
vi.mock('@alga-psa/ui/components/bento', () => ({
  BentoTile: ({ children, action, title, subtitle }: any) => <section><h2>{title}</h2><p>{subtitle}</p>{action}{children}</section>,
  BentoStat: ({ value, label }: any) => <span data-testid={`stat-${label}`}>{value}</span>,
}));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedPurchaseState: actions.state }));
vi.mock('@enterprise/lib/actions/coManagedBillingActions', () => ({
  previewCoManagedSeatsAction: actions.preview, purchaseCoManagedSeatsAction: actions.purchase,
}));
vi.mock('@enterprise/components/co-managed/CoManagedCheckout', () => ({ default: () => null }));
vi.mock('@/components/co-managed/accessRefresh', () => ({ announceCoManagedAccessChanged: actions.announce, CO_MANAGED_ACCESS_CHANGED: 'x' }));

import CoManagedPoolEditor from '@/components/co-managed/CoManagedPoolEditor';
import CoManagedPoolExplainer from '@/components/co-managed/CoManagedPoolExplainer';

const purchase = (over: Record<string, unknown> = {}) => ({
  pending: null, awaitingVerification: null, minimumQuantity: 1, canPurchase: true, canResume: false, reason: 'available', ...over });
const pool = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) => ({
  capacity: 0, allocated: 0, available: 0, canGrow: false, isReadOnly: false, graceEndsAt: null, selfHosted: false,
  purchase: purchase(p), ...over });
const owned = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) =>
  pool({ capacity: 5, allocated: 3, available: 2, ...over }, { minimumQuantity: 3, ...p });
const quote = { kind: 'quote', unitAmount: 1149, monthlyTotal: 1149, amountDue: 1149, currency: 'eur', offerRef: 'reviewed-offer' };

beforeEach(() => {
  actions.state.mockReset().mockResolvedValue(pool());
  actions.preview.mockReset().mockResolvedValue(quote);
  actions.purchase.mockReset(); actions.announce.mockReset();
});
afterEach(cleanup);

describe('state A: no seats purchased', () => {
  it('shows no tiles, a labelled stepper at 1, and the live price from the existing preview', async () => {
    render(<CoManagedPoolEditor showTotals explainer={<div>explainer slot</div>} />);
    const input = await screen.findByLabelText('coManaged.howMany');
    expect(input).toHaveValue(1);
    expect(screen.queryAllByTestId(/stat-/)).toHaveLength(0);
    expect(screen.getByText('explainer slot')).toBeInTheDocument();
    expect(screen.getByText('coManaged.noSeatsYet')).toBeInTheDocument();
    expect(screen.getByText('coManaged.reviewHint')).toBeInTheDocument();
    expect(await screen.findByText('eur 11.49')).toBeInTheDocument();
    expect(screen.getByText('coManaged.priceBreakdown 1 eur 11.49')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.increaseSeats' }));
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.increaseSeats' }));
    expect(input).toHaveValue(3);
    expect(screen.getByText('eur 34.47')).toBeInTheDocument();
    expect(screen.getByText('coManaged.priceBreakdown 3 eur 11.49')).toBeInTheDocument();
    // One unit-price read, not one per change of the quantity.
    expect(actions.preview).toHaveBeenCalledTimes(1);
    expect(actions.preview).toHaveBeenCalledWith(1);
  });

  it('Review purchase passes the chosen quantity into the existing review with the same amounts', async () => {
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.change(await screen.findByLabelText('coManaged.howMany'), { target: { value: '3' } });
    actions.preview.mockResolvedValueOnce({ ...quote, monthlyTotal: 3447, amountDue: 3447 });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.reviewPurchase' }));
    await waitFor(() => expect(actions.preview).toHaveBeenLastCalledWith(3));
    expect(await screen.findByText(/coManaged\.monthlyTotal 3 eur 34\.47/)).toBeInTheDocument();
    expect(screen.getByText(/coManaged\.dueNow eur 34\.47/)).toBeInTheDocument();
  });

  it('keeps the stepper and button without a price when the price cannot be read, and review still reports it', async () => {
    actions.preview.mockResolvedValue({ kind: 'blocked', reason: 'temporarily_unavailable' });
    render(<CoManagedPoolEditor showTotals />);
    const input = await screen.findByLabelText('coManaged.howMany');
    await waitFor(() => expect(actions.preview).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/eur/)).not.toBeInTheDocument();
    expect(screen.queryByText(/priceBreakdown/)).not.toBeInTheDocument();
    expect(input).toBeEnabled();
    actions.preview.mockRejectedValue(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.reviewPurchase' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not price this change. Refresh and try again.');
  });

  it('does not read a price for a purchaser who cannot purchase', async () => {
    actions.state.mockResolvedValue(pool({}, { canPurchase: false, reason: 'no_permission' }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByText('An account administrator must add co-managed capacity.')).toBeInTheDocument();
    expect(actions.preview).not.toHaveBeenCalled();
  });

  it('without an explainer (Account Management) it has the quantity row but no how-it-works content', async () => {
    render(<CoManagedPoolEditor showTotals />);
    await screen.findByLabelText('coManaged.howMany');
    expect(screen.queryByText('explainer slot')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'coManaged.reviewPurchase' })).toBeInTheDocument();
  });
});

describe('state B: seats owned', () => {
  beforeEach(() => { actions.state.mockResolvedValue(owned()); });
  it('shows tiles and usage, the free-seat line, and the change summary', async () => {
    render(<CoManagedPoolEditor showTotals explainer={<div>explainer slot</div>} clientsHref="/msp/clients" />);
    const input = await screen.findByLabelText('coManaged.quantity');
    expect(screen.getAllByTestId(/stat-/).map((n) => n.textContent)).toEqual(['5', '3', '2']);
    expect(screen.getByRole('progressbar', { name: 'coManaged.usage 3 5' })).toBeInTheDocument();
    expect(screen.getByText('coManaged.freeToAllocate 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /coManaged\.goToClients/ })).toHaveAttribute('href', '/msp/clients');
    // The explainer is for the first purchase only.
    expect(screen.queryByText('explainer slot')).not.toBeInTheDocument();
    expect(screen.getByText('coManaged.changeTitle')).toBeInTheDocument();
    expect(screen.getByText('coManaged.manageBilling')).toBeInTheDocument();
    expect(screen.queryByText('coManaged.buySeats')).not.toBeInTheDocument();

    const change = screen.getByRole('button', { name: 'coManaged.reviewChange' });
    expect(input).toHaveValue(5);
    expect(change).toBeDisabled();
    expect(screen.queryByText(/coManaged\.adding|coManaged\.removing/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '7' } });
    expect(await screen.findByText('coManaged.adding 2')).toBeInTheDocument();
    expect(screen.getByText('coManaged.fromTo 5 7')).toBeInTheDocument();
    expect(screen.getByText('coManaged.monthlyWithDifference eur 80.43 +eur 22.98')).toBeInTheDocument();
    expect(change).toBeEnabled();
    fireEvent.click(change);
    await waitFor(() => expect(actions.preview).toHaveBeenLastCalledWith(7));

    fireEvent.change(input, { target: { value: '4' } });
    expect(screen.getByText('coManaged.removing 1')).toBeInTheDocument();
    expect(screen.getByText('coManaged.monthlyWithDifference eur 45.96 eur -11.49')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '5' } });
    expect(change).toBeDisabled();
  });

  it('shows no Clients link unless the actor may open clients', async () => {
    render(<CoManagedPoolEditor showTotals />);
    await screen.findByLabelText('coManaged.quantity');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('refuses a total below the allocated seats and says why', async () => {
    render(<CoManagedPoolEditor showTotals />);
    const input = await screen.findByLabelText('coManaged.quantity');
    fireEvent.change(input, { target: { value: '2' } });
    expect(screen.getByRole('alert')).toHaveTextContent('coManaged.belowAllocated 3');
    expect(screen.getByRole('button', { name: 'coManaged.reviewChange' })).toBeDisabled();
        expect(screen.getByText('coManaged.manageBilling')).toBeDisabled();
    expect(actions.preview).toHaveBeenCalledTimes(1);
  });

  it('shows the change summary without a price when the price cannot be read', async () => {
    actions.preview.mockResolvedValue({ kind: 'blocked', reason: 'offer_paused' });
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.change(await screen.findByLabelText('coManaged.quantity'), { target: { value: '6' } });
    expect(screen.getByText('coManaged.adding 1')).toBeInTheDocument();
    expect(screen.getByText('coManaged.fromTo 5 6')).toBeInTheDocument();
    expect(screen.queryByText(/monthlyWithDifference/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'coManaged.reviewChange' })).toBeEnabled();
  });

  it('keeps the grace and read-only notices', async () => {
    actions.state.mockResolvedValue(owned({ graceEndsAt: '2026-12-01T00:00:00.000Z' }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByText(/coManaged\.grace/)).toBeInTheDocument();
    cleanup();
    actions.state.mockResolvedValue(owned({ graceEndsAt: '2026-12-01T00:00:00.000Z', isReadOnly: true }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByText(/coManaged\.readOnly/)).toBeInTheDocument();
  });
});

describe('every existing state has a place in both layouts', () => {
  const states: Array<[string, Record<string, unknown>, () => void]> = [
    ['resume purchase', { pending: { operationId: 'o', quantity: 5, state: 'checkout' }, canPurchase: false, canResume: true, reason: 'pending' },
      () => { expect(screen.getByText('A purchase of 5 seats is pending.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'coManaged.resumePurchase' })).toBeInTheDocument(); }],
    ['awaiting verification', { awaitingVerification: { operationId: 'o', quantity: 3 }, canPurchase: false, reason: 'awaiting_verification' },
      () => { expect(screen.getByText(/awaiting payment verification/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Refresh status' })).toBeInTheDocument(); }],
    ['needs admin', { canPurchase: false, reason: 'no_permission' },
      () => expect(screen.getByText('An account administrator must add co-managed capacity.')).toBeInTheDocument()],
    ['purchasing unavailable', { canPurchase: false, reason: 'implementation_unavailable' },
      () => expect(screen.getByText('Hosted co-managed purchasing is not available in this deployment.')).toBeInTheDocument()],
    ['pro required', { canPurchase: false, reason: 'ineligible' },
      () => expect(screen.getByText('coManaged.proRequired')).toBeInTheDocument()],
  ];
  it.each(states)('%s, before the first purchase', async (_name, p, check) => {
    actions.state.mockResolvedValue(pool({}, p));
    render(<CoManagedPoolEditor showTotals explainer={<div>explainer slot</div>} />);
    await waitFor(() => check());
    expect(within(document.getElementById('co-managed-buy-seats')!).getByText('coManaged.noSeatsYet')).toBeInTheDocument();
    expect(screen.queryByLabelText('coManaged.howMany')).not.toBeInTheDocument();
  });
  it.each(states)('%s, with seats owned', async (_name, p, check) => {
    actions.state.mockResolvedValue(owned({}, p));
    render(<CoManagedPoolEditor showTotals />);
    await waitFor(() => check());
    expect(screen.getAllByTestId(/stat-/)).toHaveLength(3);
    expect(screen.queryByLabelText('coManaged.quantity')).not.toBeInTheDocument();
  });

  it('shows the expired checkout in the purchase box layout and after a change', async () => {
    actions.purchase.mockResolvedValue({ kind: 'expired', publishableKey: null });
    actions.state.mockResolvedValue(owned());
    render(<CoManagedPoolEditor showTotals />);
    fireEvent.change(await screen.findByLabelText('coManaged.quantity'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'coManaged.reviewChange' }));
    fireEvent.click(await screen.findByText('coManaged.confirmPurchase'));
    expect(await screen.findByText('The checkout session expired. Review the purchase again.')).toBeInTheDocument();
    expect(screen.getByLabelText('coManaged.quantity')).toBeEnabled();
  });

  it('self-hosted keeps the licence link in place of the quantity control', async () => {
    actions.state.mockResolvedValue(owned({ selfHosted: true }));
    render(<CoManagedPoolEditor showTotals />);
    expect(await screen.findByRole('link', { name: /coManaged\.manageLicense/ })).toHaveAttribute('href', '/msp/licenses');
    expect(screen.queryByLabelText('coManaged.quantity')).not.toBeInTheDocument();
    expect(actions.preview).not.toHaveBeenCalled();
  });
});

describe('naming', () => {
  it('no co-managed surface string says "customer technician seats" or "customer seats"', () => {
    const forbidden = /customer (technician )?seats?\b/i;
    const locales = resolve(process.cwd(), 'public/locales');
    for (const locale of readdirSync(locales)) {
      const file = readFileSync(resolve(locales, locale, 'msp/licensing.json'), 'utf8');
      expect(JSON.parse(file).coManaged).toBeDefined();
      expect(JSON.stringify(JSON.parse(file).coManaged)).not.toMatch(forbidden);
    }
    for (const name of ['CoManagedPoolEditor', 'CoManagedPoolQuantity', 'CoManagedPoolExplainer', 'CoManagedPurchaseReview']) {
      expect(readFileSync(resolve(process.cwd(), `src/components/co-managed/${name}.tsx`), 'utf8')).not.toMatch(forbidden);
    }
  });
});

describe('explainer and page copy', () => {
  it('lists the three numbered steps and who needs a seat', () => {
    render(<CoManagedPoolExplainer />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('coManaged.howItWorks.title')).toBeInTheDocument();
    expect(screen.getByText('coManaged.whoNeedsSeat.label')).toBeInTheDocument();
  });

  it('the page subtitle is the approved explanation, word for word', () => {
    const en = JSON.parse(readFileSync(resolve(process.cwd(), 'public/locales/en/msp/licensing.json'), 'utf8')).coManaged;
    expect(en.description).toBe("Co-managed IT lets a client's own IT staff work alongside your team in AlgaPSA — on the same tickets, with access limited to their company. Each client technician uses one seat from a pool you buy here.");
  });
});
