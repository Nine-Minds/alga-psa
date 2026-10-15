/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T023/T024/T025 (2026-10-14 amendment): the lazy callout strip, the menu badge
 * and the provider that feeds both. Silence is the contract: any error, empty
 * answer, zero count or disabled gate renders nothing.
 */

const mocks = vi.hoisted(() => ({ flag: vi.fn(), signals: vi.fn(), tier: vi.fn(), product: vi.fn(), replace: vi.fn() }));

vi.mock('@alga-psa/ui/hooks', () => ({ useFeatureFlag: mocks.flag }));
vi.mock('@/lib/actions/coManagedTicketQueueActions', () => ({ getCoManagedWorkSignalsAction: mocks.signals }));
vi.mock('@/context/TierContext', () => ({ useTier: mocks.tier }));
vi.mock('@/context/ProductContext', () => ({ useProduct: mocks.product }));
vi.mock('next/navigation', () => ({ usePathname: () => '/msp/tickets', useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; defaultValue?: string }) =>
      options?.count !== undefined ? `${key}:${options.count}` : (options?.defaultValue ?? key),
  }),
}));
vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: ({ id }: any) => ({ automationIdProps: { id }, updateMetadata() {}, updateActions() {} }),
}));

import { CoManagedWorkSignalsProvider } from '../../../components/co-managed/CoManagedWorkSignalsProvider';
import { CoManagedCalloutStrip, CoManagedClientCalloutStrip, calloutHref, useCalloutDismissal } from '../../../components/co-managed/CoManagedCalloutStrip';
import SidebarSubMenuItem from '../../../components/layout/SidebarSubMenuItem';

const READY = { assignedRelationshipCount: 2, signals: { escalatedUnassigned: 3, awaitingReply: 4 } };

const mount = (viewerId: string | null = 'viewer-1') => render(
  <CoManagedWorkSignalsProvider viewerId={viewerId}><CoManagedCalloutStrip /></CoManagedWorkSignalsProvider>,
);

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  mocks.flag.mockReturnValue({ enabled: true, loading: false, error: null });
  mocks.tier.mockReturnValue({ isPro: true });
  mocks.product.mockReturnValue({ productCode: 'psa' });
  mocks.signals.mockResolvedValue(READY);
});
afterEach(() => {
  cleanup();
  // Restores storage spies even when an assertion threw before an inline restore.
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('T023 — callout strip', () => {
  it('shows each signal as a deep link to Customer Tickets with the matching filter', async () => {
    mount();
    const escalated = await screen.findByRole('link', { name: 'coManaged.callout.escalatedUnassigned:3' });
    expect(escalated).toHaveAttribute('href', '/msp/tickets/customer?queueView=working&workspace=all&signal=escalated_unassigned');
    expect(screen.getByRole('link', { name: 'coManaged.callout.awaitingReply:4' }))
      .toHaveAttribute('href', '/msp/tickets/customer?queueView=working&workspace=all&signal=awaiting_reply');
    expect(calloutHref('awaiting_reply', 'c1')).toContain('clientId=c1');
  });

  it('loads lazily after mount through the one action and never asks until the gate resolves', async () => {
    mocks.flag.mockReturnValue({ enabled: false, loading: false, error: null });
    mount();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
  });

  it.each([
    ['flag still loading', () => mocks.flag.mockReturnValue({ enabled: true, loading: true, error: null })],
    ['flag errored', () => mocks.flag.mockReturnValue({ enabled: true, loading: false, error: new Error('x') })],
    ['tenant not Pro', () => mocks.tier.mockReturnValue({ isPro: false })],
    ['non-PSA product', () => mocks.product.mockReturnValue({ productCode: 'co_managed' })],
  ])('renders nothing and makes no read when %s', async (_name, arrange) => {
    arrange();
    mount();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
  });

  it.each([
    ['an action error', () => mocks.signals.mockRejectedValue(new Error('denied'))],
    ['an empty answer', () => mocks.signals.mockResolvedValue(undefined)],
    ['zero counts', () => mocks.signals.mockResolvedValue({ assignedRelationshipCount: 1, signals: { escalatedUnassigned: 0, awaitingReply: 0 } })],
    ['no assigned relationship', () => mocks.signals.mockResolvedValue({ assignedRelationshipCount: 0, signals: { escalatedUnassigned: 5, awaitingReply: 5 } })],
  ])('renders nothing on %s', async (_name, arrange) => {
    arrange();
    mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
  });

  it('shows only the non-zero segment', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 1, signals: { escalatedUnassigned: 0, awaitingReply: 2 } });
    mount();
    expect(await screen.findByRole('link', { name: 'coManaged.callout.awaitingReply:2' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: /escalatedUnassigned/ })).toBeNull());
  });
});

describe('T023 — dismissal is per viewer and per count', () => {
  it('stays dismissed for the same viewer and counts, across a remount', async () => {
    const first = mount();
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
    first.unmount();
    mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
  });

  it('is remembered per viewer: another viewer on the same browser still sees it', async () => {
    const first = mount('viewer-1');
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    first.unmount();
    mount('viewer-2');
    expect(await screen.findByTestId('co-managed-callout')).toBeInTheDocument();
  });

  const dismissAt = async (counts: { escalatedUnassigned: number; awaitingReply: number }) => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: counts });
    const first = mount();
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    first.unmount();
  };

  it('shows the strip again for new work after a dismissed count fell to zero (3 -> dismiss -> 0 -> 2)', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 3, awaitingReply: 0 } });
    const first = mount();
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    first.unmount();
    // All three handled: the count is 0 and nothing renders, but the stored dismissal must reset.
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 0, awaitingReply: 0 } });
    const second = mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
    second.unmount();
    // Two new escalations arrive.
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 2, awaitingReply: 0 } });
    mount();
    expect(await screen.findByRole('link', { name: 'coManaged.callout.escalatedUnassigned:2' })).toBeInTheDocument();
  });

  it('keeps the dismissal while the count is unknown (error) so a failed read does not reset it', async () => {
    await dismissAt({ escalatedUnassigned: 2, awaitingReply: 2 });
    mocks.signals.mockRejectedValue(new Error('denied'));
    mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(JSON.parse(window.localStorage.getItem('alga.coManaged.callout.dismissed:viewer-1:all')!)).toEqual({ escalatedUnassigned: 2, awaitingReply: 2 });
  });

  it('stays dismissed while the count is at or below what was dismissed but above zero, and a rise past the lowered value returns', async () => {
    await dismissAt({ escalatedUnassigned: 3, awaitingReply: 0 });
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 2, awaitingReply: 0 } });
    const second = mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
    second.unmount();
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 3, awaitingReply: 0 } });
    mount();
    expect(await screen.findByRole('link', { name: 'coManaged.callout.escalatedUnassigned:3' })).toBeInTheDocument();
  });

  it('returns when the count rises above the dismissed value', async () => {
    await dismissAt({ escalatedUnassigned: 2, awaitingReply: 2 });
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 3, awaitingReply: 2 } });
    mount();
    expect(await screen.findByRole('link', { name: 'coManaged.callout.escalatedUnassigned:3' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /awaitingReply/ })).toBeNull();
  });

  it('returns when a count changes, only for the segment that changed', async () => {
    const first = mount();
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    first.unmount();
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 2, signals: { escalatedUnassigned: 3, awaitingReply: 9 } });
    mount();
    expect(await screen.findByRole('link', { name: 'coManaged.callout.awaitingReply:9' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /escalatedUnassigned/ })).toBeNull();
  });

  it('still dismisses for the page when browser storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    mount('viewer-unavailable');
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
  });

  it('keeps an in-memory dismissal across a remount for the life of the page when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const { result, unmount } = renderHook(() => useCalloutDismissal('viewer-memory', 'all'));
    act(() => result.current[1]({ escalatedUnassigned: 3, awaitingReply: 4 }));
    unmount();
    const again = renderHook(() => useCalloutDismissal('viewer-memory', 'all'));
    expect(again.result.current[0]).toEqual({ escalatedUnassigned: 3, awaitingReply: 4 });
  });
});

describe('T023 — dismissal is correct on the first render and per key', () => {
  const COUNTS = { escalatedUnassigned: 3, awaitingReply: 4 };
  const keyFor = (viewer: string) => `alga.coManaged.callout.dismissed:${viewer}:all`;

  it('never renders a dismissed strip, not even for one commit, once the signals resolve', async () => {
    window.localStorage.setItem(keyFor('viewer-1'), JSON.stringify(COUNTS));
    // A transient commit is invisible to a final-state assertion, so record every node insertion.
    const appeared: Node[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => {
          if (node instanceof Element && (node.matches('[data-testid="co-managed-callout"]') || node.querySelector('[data-testid="co-managed-callout"]'))) appeared.push(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    mount();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    // Let the resolved signals commit; a strip that painted would have been inserted by now.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    observer.disconnect();
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
    expect(appeared).toEqual([]);
  });

  it('reads the stored dismissal on the hook\'s very first render', () => {
    window.localStorage.setItem(keyFor('viewer-1'), JSON.stringify(COUNTS));
    const seen: unknown[] = [];
    renderHook(() => { const [dismissed] = useCalloutDismissal('viewer-1', 'all'); seen.push(dismissed); return dismissed; });
    expect(seen[0]).toEqual(COUNTS);
  });

  it('applies the new key\'s dismissal, never the previous key\'s, when the viewer changes on a mounted component', () => {
    window.localStorage.setItem(keyFor('viewer-1'), JSON.stringify(COUNTS));
    const seen: Array<{ viewer: string | null; value: unknown }> = [];
    const { rerender } = renderHook(({ viewer }: { viewer: string | null }) => {
      const [dismissed] = useCalloutDismissal(viewer, 'all');
      seen.push({ viewer, value: dismissed });
      return dismissed;
    }, { initialProps: { viewer: 'viewer-1' as string | null } });
    seen.length = 0;
    rerender({ viewer: 'viewer-2' });
    rerender({ viewer: 'viewer-1' });
    // viewer-2 has nothing stored: every render for it is empty; viewer-1 is dismissed on every render for it.
    for (const entry of seen) {
      expect(entry.value).toEqual(entry.viewer === 'viewer-1' ? COUNTS : {});
    }
    expect(seen.some(entry => entry.viewer === 'viewer-2')).toBe(true);
  });

  it('shows the strip for a second viewer after the mounted viewer switches', async () => {
    window.localStorage.setItem(keyFor('viewer-1'), JSON.stringify(COUNTS));
    const view = render(<CoManagedWorkSignalsProvider viewerId="viewer-1"><CoManagedCalloutStrip /></CoManagedWorkSignalsProvider>);
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
    view.rerender(<CoManagedWorkSignalsProvider viewerId="viewer-2"><CoManagedCalloutStrip /></CoManagedWorkSignalsProvider>);
    expect(await screen.findByTestId('co-managed-callout')).toBeInTheDocument();
  });
});

describe('T024 — menu badge', () => {
  const ITEM = { name: 'Customer Tickets', icon: () => null, href: '/msp/tickets/customer', badgeSource: 'co-managed-work' as const };
  const renderItem = () => render(
    <CoManagedWorkSignalsProvider viewerId="v">
      <SidebarSubMenuItem item={ITEM} parentId="menu-tickets" isActive={() => false} />
    </CoManagedWorkSignalsProvider>,
  );

  it('shows the sum of the two signals', async () => {
    renderItem();
    expect(await screen.findByTestId('co-managed-work-badge')).toHaveTextContent('7');
  });

  it('shows no badge at zero, on error, or when the gate is closed', async () => {
    mocks.signals.mockResolvedValue({ assignedRelationshipCount: 1, signals: { escalatedUnassigned: 0, awaitingReply: 0 } });
    const zero = renderItem();
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    expect(screen.queryByTestId('co-managed-work-badge')).toBeNull();
    zero.unmount();
    mocks.signals.mockRejectedValue(new Error('x'));
    renderItem();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-work-badge')).toBeNull();
  });

  it('shows no badge on items that do not name the source', async () => {
    render(
      <CoManagedWorkSignalsProvider viewerId="v">
        <SidebarSubMenuItem item={{ ...ITEM, badgeSource: undefined, name: 'All Tickets', href: '/msp/tickets' }} parentId="menu-tickets" isActive={() => false} />
      </CoManagedWorkSignalsProvider>,
    );
    await waitFor(() => expect(mocks.signals).toHaveBeenCalled());
    expect(screen.queryByTestId('co-managed-work-badge')).toBeNull();
  });
});

describe('T025 — client-scoped callout', () => {
  it('asks for counts narrowed to the client; each segment links to Customer Tickets filtered by signal and client', async () => {
    mocks.signals.mockImplementation(async (request: { clientId?: string }) =>
      request?.clientId ? { assignedRelationshipCount: 1, signals: { escalatedUnassigned: 1, awaitingReply: 2 } } : READY);
    render(
      <CoManagedWorkSignalsProvider viewerId="v"><CoManagedClientCalloutStrip clientId="client-1" /></CoManagedWorkSignalsProvider>,
    );
    const escalated = await screen.findByRole('link', { name: 'coManaged.callout.escalatedUnassigned:1' });
    const awaiting = screen.getByRole('link', { name: 'coManaged.callout.awaitingReply:2' });
    for (const [link, signal] of [[escalated, 'escalated_unassigned'], [awaiting, 'awaiting_reply']] as const) {
      const url = new URL(link.getAttribute('href') as string, 'http://localhost');
      expect(url.pathname).toBe('/msp/tickets/customer');
      expect(url.searchParams.get('signal')).toBe(signal);
      expect(url.searchParams.get('clientId')).toBe('client-1');
    }
    expect(mocks.signals).toHaveBeenCalledWith({ clientId: 'client-1' });
  });

  it('renders nothing when the client has no signal or the read fails', async () => {
    mocks.signals.mockImplementation(async (request: { clientId?: string }) => {
      if (request?.clientId) throw new Error('denied');
      return READY;
    });
    render(<CoManagedWorkSignalsProvider viewerId="v"><CoManagedClientCalloutStrip clientId="client-1" /></CoManagedWorkSignalsProvider>);
    await waitFor(() => expect(mocks.signals).toHaveBeenCalledWith({ clientId: 'client-1' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
  });
});
