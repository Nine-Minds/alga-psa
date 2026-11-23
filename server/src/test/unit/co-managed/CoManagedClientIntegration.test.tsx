// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { view } from './fixtures';

const capability = vi.hoisted(() => ({ admitted: true, seat: false }));
const getView = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/ui/hooks', () => ({
  useCapability: (key: string) => key === 'co-managed-seat'
    ? { enabled: capability.seat, admitted: capability.seat, resolved: true }
    : { enabled: capability.admitted, admitted: capability.admitted, resolved: true },
}));
const getSeat = vi.hoisted(() => vi.fn());
const getOffer = vi.hoisted(() => vi.fn());
vi.mock('@enterprise/lib/actions/coManagedSeatTrialActions', () => ({ getSeatTrialOfferAction: getOffer }));
// The card is presentational; this stand-in shows the offer it was handed.
vi.mock('@enterprise/components/co-managed/CoManagedSeatTrial', () => ({
  default: ({ offer }: any) => offer ? <div>trial-card:{offer.canStart ? 'available' : offer.pilot?.status}</div> : null,
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({ getCoManagedSeatClientState: getSeat }));
vi.mock('@/components/co-managed/CoManagedSeatClientView', () => ({ default: ({ children }: any) => <div>seat-tab-body{children}</div> }));
vi.mock('@/components/co-managed/CoManagedSeatSummary', () => ({ default: () => <div>seat-summary</div> }));
vi.mock('@/components/co-managed/CoManagedShapeChooser', () => ({ default: ({ workspaceSetup, story }: any) => <div>chooser{workspaceSetup ? '+workspace' : ''}:{story?.tone}:{story?.notice ?? 'no-notice'}</div> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
vi.mock('@/lib/actions/coManagedActions', () => ({ getCoManagedClientManagement: getView }));
vi.mock('@/components/co-managed/CoManagedClientView', () => ({ default: () => <div>tab-body</div> }));
vi.mock('@/components/co-managed/CoManagedClientSummary', () => ({ default: () => <div>summary</div> }));

import Integration from '@/components/co-managed/CoManagedClientIntegration';

const mount = (children: (slots: any) => React.ReactNode) =>
  render(<Integration clientId="client-1" clientName="Acme" idPrefix="t" children={children} />);

beforeEach(() => { capability.admitted = true; capability.seat = false; getView.mockReset(); getSeat.mockReset(); getOffer.mockReset().mockResolvedValue(null); });
afterEach(cleanup);

describe('client co-managed integration slots', () => {
  it('capability off: children(null) and no action call', async () => {
    capability.admitted = false;
    const children = vi.fn(() => <div>ordinary</div>);
    mount(children);
    expect(screen.getByText('ordinary')).toBeInTheDocument();
    expect(children).toHaveBeenLastCalledWith(null);
    expect(getView).not.toHaveBeenCalled();
    expect(getSeat).not.toHaveBeenCalled();
  });

  // Flag-off neutrality: with the seat capability closed the integration never reads seat state.
  it('seat capability closed: workspace slots exactly as before and no seat read', async () => {
    getView.mockResolvedValue(view());
    let latest: any = null;
    mount((slots) => { latest = slots; return <div>{slots?.summary}</div>; });
    await waitFor(() => expect(screen.getByText('summary')).toBeInTheDocument());
    expect(latest.tab.id).toBe('co-managed');
    expect(getSeat).not.toHaveBeenCalled();
    expect(screen.queryByText('seat-summary')).not.toBeInTheDocument();
  });

  it('seat capability open, no arrangement: the workspace summary stays and the chooser wraps the workspace setup', async () => {
    capability.seat = true;
    getView.mockResolvedValue(view());
    getSeat.mockResolvedValue({ panel: null, canManage: true, enable: { capacity: { purchased: 3, allocated: 1, available: 2 }, blocker: null } });
    let latest: any = null;
    mount((slots) => { latest = slots; return <div>{slots?.summary}</div>; });
    await waitFor(() => expect(screen.getByText('summary')).toBeInTheDocument());
    await waitFor(() => expect(getSeat).toHaveBeenCalledWith('client-1'));
    expect(latest.tab.id).toBe('co-managed');
  });

  it('seat capability open with an arrangement: the seat summary replaces the workspace one', async () => {
    capability.seat = true;
    getView.mockResolvedValue(view());
    getSeat.mockResolvedValue({ panel: { usedSeats: 1, seats: 2 }, canManage: true, enable: null });
    mount((slots) => <div>{slots?.summary}</div>);
    await waitFor(() => expect(screen.getByText('seat-summary')).toBeInTheDocument());
    expect(screen.queryByText('summary')).not.toBeInTheDocument();
  });

  it('only the seat capability open: a seat-only tab, and no workspace read', async () => {
    capability.admitted = false;
    capability.seat = true;
    getSeat.mockResolvedValue({ panel: null, canManage: true, enable: { capacity: { purchased: 3, allocated: 1, available: 2 }, blocker: null } });
    let latest: any = null;
    mount((slots) => { latest = slots; return <div>{slots?.tab?.content}</div>; });
    await waitFor(() => expect(screen.getByText(/seat-tab-body/)).toBeInTheDocument());
    expect(screen.getByText(/chooser/)).toBeInTheDocument();
    expect(screen.queryByText(/\+workspace/)).not.toBeInTheDocument();
    expect(latest.tab.id).toBe('co-managed');
    expect(getView).not.toHaveBeenCalled();
  });

  it('seat state unreadable: the ordinary client', async () => {
    capability.admitted = false;
    capability.seat = true;
    getSeat.mockRejectedValue(new Error('denied'));
    const seen: any[] = [];
    mount((slots) => { seen.push(slots); return <div>ordinary</div>; });
    await waitFor(() => expect(getSeat).toHaveBeenCalled());
    await Promise.resolve();
    expect(seen.every((slots) => slots === null)).toBe(true);
  });

  it('read denied: no summary, no tab', async () => {
    getView.mockRejectedValue(new Error('denied'));
    const seen: any[] = [];
    mount((slots) => { seen.push(slots); return <div>ordinary</div>; });
    await waitFor(() => expect(getView).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(seen.every((slots) => slots === null)).toBe(true);
    expect(screen.queryByText('summary')).not.toBeInTheDocument();
  });

  it('ready: a summary and exactly one co-managed tab', async () => {
    getView.mockResolvedValue(view());
    let latest: any = null;
    mount((slots) => { latest = slots; return <div>{slots?.summary}</div>; });
    await waitFor(() => expect(screen.getByText('summary')).toBeInTheDocument());
    expect(latest.tab.id).toBe('co-managed');
    expect(latest.tab.hasUnsavedChanges()).toBe(false);
    expect(getView).toHaveBeenCalledTimes(1);
  });
});

describe('seat trial and chooser tell one story', () => {
  const blockedEnable = { capacity: { purchased: 0, allocated: 0, available: 0 }, blocker: 'SPONSOR_NOT_ELIGIBLE' };
  const seatOnly = () => {
    capability.admitted = false; capability.seat = true;
    getSeat.mockResolvedValue({ panel: null, canManage: true, enable: blockedEnable });
    mount((slots) => <div>{slots?.tab?.content}</div>);
  };

  for (const [name, offer, card, notice] of [
    ['available', { canStart: true, canPurchase: false, intake: true, pilot: null, price: null }, 'trial-card:available', 'available'],
    ['pending', { canStart: false, canPurchase: true, intake: true, pilot: { trialId: 't', status: 'pending', invited: true }, price: null }, 'trial-card:pending', 'pending'],
  ] as const) {
    it(`${name}: the offer is read once and the card and chooser agree`, async () => {
      getOffer.mockResolvedValue(offer);
      seatOnly();
      await waitFor(() => expect(screen.getByText(card)).toBeInTheDocument());
      expect(screen.getByText(`chooser:trial:${notice}`)).toBeInTheDocument();
      expect(getOffer).toHaveBeenCalledTimes(1);
      expect(getOffer).toHaveBeenCalledWith('client-1');
    });
  }

  it('no trial: the chooser is blocked with no notice', async () => {
    seatOnly();
    await waitFor(() => expect(screen.getByText('chooser:blocked:no-notice')).toBeInTheDocument());
    expect(getOffer).toHaveBeenCalledTimes(1);
  });

  it('holds the chooser back until the offer has settled', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    getOffer.mockReturnValue(new Promise((r) => { resolve = r; }));
    seatOnly();
    await waitFor(() => expect(getSeat).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/seat-tab-body/)).toBeInTheDocument());
    expect(screen.queryByText(/chooser/)).not.toBeInTheDocument();
    resolve({ canStart: true, canPurchase: false, intake: true, pilot: null, price: null });
    await waitFor(() => expect(screen.getByText('chooser:trial:available')).toBeInTheDocument());
  });
});
