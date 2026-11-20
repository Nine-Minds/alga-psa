// @vitest-environment jsdom
/**
 * T047 (S37 / F090), render half: with `co-managed-seat` closed, every seat entry point is absent and no seat
 * action or read is made. Every case drives the REAL capability hook through FeatureFlagBootstrapProvider and
 * is paired with the capability-on case, so the assertions can fail.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { FeatureFlagBootstrapProvider } from '@alga-psa/ui/capability/bootstrapContext';
import { view } from './fixtures';

const seatActions = vi.hoisted(() => ({
  clientState: vi.fn(), combined: vi.fn(), endPreview: vi.fn(), end: vi.fn(),
}));
const workspaceActions = vi.hoisted(() => ({ view: vi.fn(), billing: vi.fn(), overview: vi.fn() }));

vi.mock('@/lib/actions/coManagedSeatActions', () => ({
  getCoManagedSeatClientState: seatActions.clientState,
  getCoManagedCombinedOverviewAction: seatActions.combined,
  getCoManagedSeatArrangementEndPreview: seatActions.endPreview,
  endCoManagedSeatArrangementAction: seatActions.end,
}));
vi.mock('@/lib/actions/coManagedActions', () => ({
  getCoManagedClientManagement: workspaceActions.view,
  getCoManagedBillingState: workspaceActions.billing,
  getCoManagedClientOverviewAction: workspaceActions.overview,
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (typeof o === 'string' ? o : o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
  useFormatters: () => ({ formatDate: (d: Date) => d.toISOString().slice(0, 10) }),
}));
// Presentational seat children are stood in for by markers; the gate under test is above them.
vi.mock('@/components/co-managed/CoManagedSeatClientView', () => ({ default: ({ children }: any) => <div>seat-tab-body{children}</div> }));
vi.mock('@/components/co-managed/CoManagedSeatSummary', () => ({ default: () => <div>seat-summary</div> }));
vi.mock('@/components/co-managed/CoManagedShapeChooser', () => ({ default: () => <div>seat-shape-chooser</div> }));
vi.mock('@/components/co-managed/CoManagedClientView', () => ({ default: () => <div>workspace-tab</div> }));
vi.mock('@/components/co-managed/CoManagedClientSummary', () => ({ default: () => <div>workspace-summary</div> }));
vi.mock('@/components/co-managed/CoManagedCombinedOverview', () => ({ default: () => <div>seat-overview-rows</div> }));

import Integration from '@/components/co-managed/CoManagedClientIntegration';
import CoManagedOverview from '@/components/co-managed/CoManagedOverview';
import CoManagedSeatArrangementEnd from '@/components/co-managed/CoManagedSeatArrangementEnd';

const OFF = { 'release-v2-0-feature': false, 'capability:co-managed': false, 'capability:co-managed:admit': false, 'capability:co-managed-seat': false, 'capability:co-managed-seat:admit': false };
const SEAT_ON = { ...OFF, 'release-v2-0-feature': true, 'capability:co-managed-seat': true, 'capability:co-managed-seat:admit': true };
const withBootstrap = (flags: Record<string, boolean | string>) =>
  ({ children }: { children: React.ReactNode }) => <FeatureFlagBootstrapProvider initialFeatureFlags={flags}>{children}</FeatureFlagBootstrapProvider>;

const noSeatCalls = () => {
  for (const [name, fn] of Object.entries(seatActions)) expect(fn, name).not.toHaveBeenCalled();
};

beforeEach(() => {
  for (const fn of [...Object.values(seatActions), ...Object.values(workspaceActions)]) fn.mockReset();
  workspaceActions.billing.mockResolvedValue({ allocated: 0, capacity: 0 });
  workspaceActions.overview.mockResolvedValue({ rows: [], totalCount: 0 });
  workspaceActions.view.mockResolvedValue(view());
  seatActions.clientState.mockResolvedValue({ panel: { usedSeats: 1, seats: 2 }, canManage: true, enable: null });
  seatActions.combined.mockResolvedValue({ rows: [], totalCount: 0 });
});
afterEach(cleanup);

describe('client co-managed tab', () => {
  const mount = (flags: Record<string, boolean | string>) => {
    const Wrapper = withBootstrap(flags);
    return render(<Wrapper><Integration clientId="client-1" clientName="Acme" idPrefix="t"
      children={(slots: any) => <div>{slots ? <>{slots.summary}{slots.tab.content}</> : 'ordinary-client'}</div>} /></Wrapper>);
  };

  it('seat capability off (release flag off): no seat tab content, summary or chooser, and no seat read', async () => {
    mount(OFF);
    expect(screen.getByText('ordinary-client')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    for (const marker of ['seat-tab-body', 'seat-summary', 'seat-shape-chooser']) expect(screen.queryByText(marker)).not.toBeInTheDocument();
    noSeatCalls();
  });

  it('seat capability on: the seat summary and tab content appear and the seat state is read', async () => {
    mount(SEAT_ON);
    await waitFor(() => expect(screen.getByText('seat-summary')).toBeInTheDocument());
    expect(screen.getByText('seat-tab-body')).toBeInTheDocument();
    expect(seatActions.clientState).toHaveBeenCalledWith('client-1');
  });

  it('seat chooser appears with the capability on and no arrangement; absent with it off', async () => {
    seatActions.clientState.mockResolvedValue({ panel: null, canManage: true, enable: { capacity: { purchased: 3, allocated: 1, available: 2 }, blocker: null } });
    mount(SEAT_ON);
    await waitFor(() => expect(screen.getByText('seat-shape-chooser')).toBeInTheDocument());
    cleanup();
    seatActions.clientState.mockClear();
    mount({ ...OFF, 'capability:co-managed': true, 'capability:co-managed:admit': true });
    await waitFor(() => expect(screen.getByText('workspace-tab')).toBeInTheDocument());
    expect(screen.queryByText('seat-shape-chooser')).not.toBeInTheDocument();
    noSeatCalls();
  });
});

describe('co-managed overview', () => {
  const mount = (flags: Record<string, boolean | string>) => {
    const Wrapper = withBootstrap(flags);
    return render(<Wrapper><CoManagedOverview /></Wrapper>);
  };

  it('seat capability off: no seat rows and no combined read', async () => {
    mount({ ...OFF, 'capability:co-managed': true, 'capability:co-managed:admit': true });
    await waitFor(() => expect(workspaceActions.overview).toHaveBeenCalled());
    expect(screen.queryByText('seat-overview-rows')).not.toBeInTheDocument();
    noSeatCalls();
  });

  it('seat capability on: the combined overview carries the seat rows', async () => {
    mount(SEAT_ON);
    await waitFor(() => expect(screen.getByText('seat-overview-rows')).toBeInTheDocument());
  });
});

describe('seat arrangement end', () => {
  it('renders no end action with the seat capability off, and offers it when admitted', () => {
    const Off = withBootstrap(OFF);
    const { container } = render(<Off><CoManagedSeatArrangementEnd arrangementId="a1" /></Off>);
    expect(container).toBeEmptyDOMElement();
    noSeatCalls();
    cleanup();
    const On = withBootstrap(SEAT_ON);
    const on = render(<On><CoManagedSeatArrangementEnd arrangementId="a1" /></On>);
    expect(on.container).not.toBeEmptyDOMElement();
  });
});
