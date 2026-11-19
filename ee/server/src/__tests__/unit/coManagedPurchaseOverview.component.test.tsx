// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ offer: vi.fn(), reviewSeat: vi.fn(), useSeat: vi.fn(), refresh: vi.fn(), discovery: vi.fn(), editorProps: [] as unknown[],
  readers: { billing: vi.fn(), overview: vi.fn(), admit: vi.fn(), allocate: vi.fn() } }));
vi.mock('../../lib/actions/coManagedSeatTrialActions', () => ({
  getSeatTrialOfferAction: mocks.offer, reviewSeatTrialConversionAction: mocks.reviewSeat, usePaidSeatForTrialAction: mocks.useSeat,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useFormatters: () => ({ formatCurrency: (amount: number) => String(amount) }), useTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }) }));
// The only data this view may read is the purchase state the editor owns; everything operational fails the test.
vi.mock('@/components/co-managed/CoManagedPoolEditor', () => ({
  default: (props: unknown) => { mocks.editorProps.push(props); return <div id="co-managed-pool-editor">pool</div>; },
}));
vi.mock('@/lib/actions/coManagedActions', () => ({
  getCoManagedBillingState: mocks.readers.billing, getCoManagedClientOverviewAction: mocks.readers.overview,
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({ getCoManagedCombinedOverviewAction: mocks.readers.allocate }));
vi.mock('@/lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: mocks.readers.admit }));
vi.mock('../../lib/actions/coManagedPurchaseDiscoveryActions', () => ({ getCoManagedPurchaseDiscoveryAction: mocks.discovery }));

import CoManagedSeatTrial from '../../components/co-managed/CoManagedSeatTrial';
import CoManagedPurchaseOverview from '../../components/co-managed/CoManagedPurchaseOverview';
import { useCoManagedPurchaseNavigation } from '../../components/co-managed/useCoManagedPurchaseNavigation';
import { CO_MANAGED_ACCESS_CHANGED } from '@/components/co-managed/accessRefresh';

beforeEach(() => {
  mocks.offer.mockReset().mockResolvedValue({ canStart: false, canPurchase: false, pilot: null, price: { unitAmount: 999, currency: 'USD' } });
  mocks.reviewSeat.mockReset(); mocks.useSeat.mockReset(); mocks.refresh.mockReset(); mocks.discovery.mockReset().mockResolvedValue(true); mocks.editorProps = []; (Object.values(mocks.readers) as Array<ReturnType<typeof vi.fn>>).forEach((fn) => fn.mockReset()); });
afterEach(cleanup);

describe('purchase-only co-managed overview', () => {
  it('shows the pool and its explanation, and nothing operational', async () => {
    const { container } = render(<CoManagedPurchaseOverview />);
    expect(await screen.findByText(/paid seat costs .*9.99 per month/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('#co-managed-pool-editor')).not.toBeNull();
    expect(mocks.editorProps[0]).toEqual({ showTotals: true });
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.textContent).not.toMatch(/archive|SLA|Search clients|Set up co-managed/i);
    for (const reader of Object.values(mocks.readers)) expect(reader).not.toHaveBeenCalled();
  });

  it('shows local cutoffs on a bound client and requires confirmation before taking a spare paid seat', async () => {
    const base = new Date('2026-11-20T06:00:00Z');
    const deadline = new Date('2026-11-29T18:00:00Z');
    mocks.offer.mockResolvedValue({ price: { unitAmount: 1149, currency: 'EUR' }, intake: false,
      canStart: false, canPurchase: true, clientId: 'pilot-client', pilot: { trialId: 'pilot', status: 'active',
        deadline: deadline.toISOString(), baseUntil: base.toISOString(), pendingPurchase: null } });
    mocks.reviewSeat.mockResolvedValue({ kind: 'spare' });
    render(<CoManagedSeatTrial clientId="pilot-client" />);
    expect(await screen.findByText('Seat trial ends ' + deadline.toLocaleString() + '.')).toBeInTheDocument();
    expect(screen.getByText('Current base access ends ' + base.toLocaleString() + '.')).toBeInTheDocument();
    expect(screen.getByText(/paid seat costs .*11.49 per month/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Keep this seat'));
    const confirm = await screen.findByText('Confirm use of one paid seat');
    expect(mocks.useSeat).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.useSeat).toHaveBeenCalledWith('pilot'));
  });

  it('re-renders the server root when verified capacity moves (access is re-derived, not inferred)', () => {
    render(<CoManagedPurchaseOverview />);
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED)); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

function Probe({ onValue }: { onValue: (value: unknown) => void }) { onValue(useCoManagedPurchaseNavigation()); return null; }

describe('navigation contribution', () => {
  it('contributes the overview root only, with no permission requirement and no archive row', async () => {
    let value: any = null;
    render(<Probe onValue={(v) => { value = v; }} />);
    await waitFor(() => expect(value).not.toBeNull());
    expect(value.items.map((item: any) => item.href)).toEqual(['/msp/co-managed']);
    expect(value.items[0].requiredPermission).toBeUndefined();
  });

  it('contributes nothing when the server says no, and an error never opens it', async () => {
    mocks.discovery.mockResolvedValue(false);
    let value: any = 'unset';
    render(<Probe onValue={(v) => { value = v; }} />);
    await waitFor(() => expect(mocks.discovery).toHaveBeenCalled());
    expect(value).toBeNull();
    mocks.discovery.mockRejectedValue(new Error('boom'));
    act(() => { window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED)); });
    await waitFor(() => expect(mocks.discovery).toHaveBeenCalledTimes(2));
    expect(value).toBeNull();
  });

  it('an access refresh re-reads the server and never blinks an open entry out while it does', async () => {
    let value: any = null;
    let resolveSecond: (open: boolean) => void = () => undefined;
    render(<Probe onValue={(v) => { value = v; }} />);
    await waitFor(() => expect(value).not.toBeNull());
    mocks.discovery.mockReturnValue(new Promise<boolean>((resolve) => { resolveSecond = resolve; }));
    act(() => { window.dispatchEvent(new Event(CO_MANAGED_ACCESS_CHANGED)); });
    expect(value).not.toBeNull();
    await act(async () => { resolveSecond(true); });
    expect(value).not.toBeNull();
  });
});
