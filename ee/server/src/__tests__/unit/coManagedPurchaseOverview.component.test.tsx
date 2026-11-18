// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), discovery: vi.fn(), editorProps: [] as unknown[],
  readers: { billing: vi.fn(), overview: vi.fn(), admit: vi.fn(), allocate: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({ useTranslation: () => ({ t: (k: string, o?: any) => o?.defaultValue ?? k }) }));
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

import CoManagedPurchaseOverview from '../../components/co-managed/CoManagedPurchaseOverview';
import { useCoManagedPurchaseNavigation } from '../../components/co-managed/useCoManagedPurchaseNavigation';
import { CO_MANAGED_ACCESS_CHANGED } from '@/components/co-managed/accessRefresh';

beforeEach(() => { mocks.refresh.mockReset(); mocks.discovery.mockReset().mockResolvedValue(true); mocks.editorProps = []; Object.values(mocks.readers).forEach((fn) => fn.mockReset()); });
afterEach(cleanup);

describe('purchase-only co-managed overview', () => {
  it('shows the pool and its explanation, and nothing operational', () => {
    const { container } = render(<CoManagedPurchaseOverview />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('#co-managed-pool-editor')).not.toBeNull();
    expect(mocks.editorProps[0]).toEqual({ showTotals: true });
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.textContent).not.toMatch(/archive|SLA|Search clients|Set up co-managed/i);
    for (const reader of Object.values(mocks.readers)) expect(reader).not.toHaveBeenCalled();
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
