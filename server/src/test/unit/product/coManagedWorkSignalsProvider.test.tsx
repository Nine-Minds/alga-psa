/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The provider caches the counts. It re-reads on an interval, on focus / a return to
 * a visible tab, and on an explicit refresh(); never on navigation. Gate and silence
 * rules are unchanged.
 */
const mocks = vi.hoisted(() => ({ flag: vi.fn(), signals: vi.fn(), tier: vi.fn(), product: vi.fn(), pathname: { current: '/msp/tickets' } }));

vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@/lib/actions/coManagedTicketQueueActions', () => ({ getCoManagedWorkSignalsAction: mocks.signals }));
vi.mock('@/context/TierContext', () => ({ useTier: mocks.tier }));
vi.mock('@/context/ProductContext', () => ({ useProduct: mocks.product }));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.pathname.current }));

import {
  CO_MANAGED_SIGNALS_REFRESH_MS,
  CoManagedWorkSignalsProvider,
  useCoManagedWorkSignals,
  type CoManagedWorkSignalsValue,
} from '../../../components/co-managed/CoManagedWorkSignalsProvider';

const READY = { assignedRelationshipCount: 1, signals: { escalatedUnassigned: 1, awaitingReply: 1 } };
let latest: CoManagedWorkSignalsValue;
function Probe() { latest = useCoManagedWorkSignals(); return <span data-testid="total">{latest.total}</span>; }
const tree = () => <CoManagedWorkSignalsProvider viewerId="v"><Probe /></CoManagedWorkSignalsProvider>;

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname.current = '/msp/tickets';
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.tier.mockReturnValue({ isPro: true });
  mocks.product.mockReturnValue({ productCode: 'psa' });
  mocks.signals.mockResolvedValue(READY);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('work signals cache', () => {
  it('reads once after mount and does not read again when the pathname changes', async () => {
    const view = render(tree());
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(1));
    await settle();
    for (const path of ['/msp/tickets/customer', '/msp/clients', '/msp/tickets']) {
      mocks.pathname.current = path;
      view.rerender(tree());
      await settle();
    }
    expect(mocks.signals).toHaveBeenCalledTimes(1);
    expect(latest.total).toBe(2);
  });

  it('re-reads on window focus', async () => {
    render(tree());
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(1));
    await settle();
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 1, signals: { escalatedUnassigned: 5, awaitingReply: 0 } });
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(latest.total).toBe(5));
  });

  it('re-reads when the tab becomes visible again, not while hidden', async () => {
    render(tree());
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(1));
    await settle();
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(mocks.signals).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
  });

  it('re-reads on an explicit refresh()', async () => {
    render(tree());
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(1));
    await settle();
    act(() => latest.refresh());
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
  });

  it('re-reads on the interval', async () => {
    render(tree());
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(1));
    await settle();
    vi.useFakeTimers();
    // Re-subscribe under fake timers so the interval is the fake one.
    cleanup();
    mocks.signals.mockClear();
    render(tree());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const afterFirst = mocks.signals.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(CO_MANAGED_SIGNALS_REFRESH_MS); });
    expect(mocks.signals.mock.calls.length).toBe(afterFirst + 1);
  });

  it('stays closed and makes no read for refresh / focus when the gate is off', async () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null });
    render(tree());
    act(() => { latest.refresh(); window.dispatchEvent(new Event('focus')); });
    await settle();
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(latest.available).toBe(false);
  });

  it('stays silent when a refresh read fails', async () => {
    render(tree());
    await waitFor(() => expect(latest.available).toBe(true));
    mocks.signals.mockRejectedValue(new Error('denied'));
    act(() => latest.refresh());
    await waitFor(() => expect(latest.available).toBe(false));
  });
});
