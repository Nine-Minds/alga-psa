/** @vitest-environment jsdom */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { CoManagedCalloutStrip, CoManagedClientCalloutStrip, calloutHref } from '../../../components/co-managed/CoManagedCalloutStrip';
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
afterEach(cleanup);

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
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    mount();
    await screen.findByTestId('co-managed-callout');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('co-managed-callout')).toBeNull();
    setItem.mockRestore(); getItem.mockRestore();
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
  it('asks for counts narrowed to the client and opens the co-managed section', async () => {
    mocks.signals.mockImplementation(async (request: { clientId?: string }) =>
      request?.clientId ? { assignedRelationshipCount: 1, signals: { escalatedUnassigned: 1, awaitingReply: 0 } } : READY);
    const onOpen = vi.fn();
    render(
      <CoManagedWorkSignalsProvider viewerId="v"><CoManagedClientCalloutStrip clientId="client-1" onOpen={onOpen} /></CoManagedWorkSignalsProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'coManaged.callout.escalatedUnassigned:1' }));
    expect(onOpen).toHaveBeenCalledOnce();
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
