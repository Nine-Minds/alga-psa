// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ billing: vi.fn(), overview: vi.fn(), combined: vi.fn() }));
const capability = vi.hoisted(() => ({ admitted: true, seat: false }));

vi.mock('@alga-psa/ui/hooks', () => ({
  useCapability: (key: string) => key === 'co-managed-seat'
    ? { enabled: capability.seat, admitted: capability.seat, resolved: true }
    : { enabled: true, admitted: capability.admitted, resolved: true },
}));
vi.mock('@/lib/actions/coManagedSeatActions', () => ({ getCoManagedCombinedOverviewAction: actions.combined }));

vi.mock('@/lib/actions/coManagedActions', () => ({
  getCoManagedBillingState: actions.billing,
  getCoManagedClientOverviewAction: actions.overview,
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (_k: string, o?: any) => (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(o?.[k])) }),
}));

import CoManagedOverview from '@/components/co-managed/CoManagedOverview';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const row = (o: any = {}) => ({
  clientId: '11111111-1111-4111-8111-111111111111', relationshipId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333', clientName: 'Acme', workspaceName: 'Acme Workspace',
  state: 'active', ended: false, seats: 5, usedSeats: 2,
  invitationExpired: false, deliveryFailed: false, cleanupFailed: false, ...o,
});

beforeEach(() => { capability.admitted = true; capability.seat = false; actions.combined.mockReset(); actions.billing.mockReset().mockResolvedValue({ allocated: 3, capacity: 10 }); actions.overview.mockReset(); });
afterEach(cleanup);

describe('co-managed overview', () => {
  it('empty: pool numbers and an empty message', async () => {
    actions.overview.mockResolvedValue({ rows: [], totalCount: 0 });
    render(<CoManagedOverview />);
    await waitFor(() => expect(screen.getByText('No co-managed clients match this search.')).toBeInTheDocument());
    expect(screen.getByText('3 of 10 co-managed seats allocated.')).toBeInTheDocument();
  });

  it('populated: seat usage per row and no UUID text', async () => {
    actions.overview.mockResolvedValue({ rows: [row(), row({ operationId: 'x', clientName: 'Beta', usedSeats: null, seats: 4 })], totalCount: 2 });
    const { container } = render(<CoManagedOverview />);
    await waitFor(() => expect(screen.getByText('2 of 5 technician seats')).toBeInTheDocument());
    expect(screen.getByText('4 allocated technician seats')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(UUID);
  });

  it('failed read is an alert, not an empty list', async () => {
    actions.overview.mockRejectedValue(new Error('boom'));
    render(<CoManagedOverview />);
    await waitFor(() => expect(screen.getByText('Could not load co-managed clients.')).toBeInTheDocument());
    expect(screen.queryByText('No co-managed clients match this search.')).not.toBeInTheDocument();
  });

  it('served but not admitted: read-only; rows show but nothing links into setup, and no setup entry point', async () => {
    capability.admitted = false;
    actions.overview.mockResolvedValue({ rows: [row()], totalCount: 1 });
    const { container } = render(<CoManagedOverview initialClientId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(screen.getByText(/read-only for this workspace/)).toBeInTheDocument();
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(screen.queryByText('View details')).not.toBeInTheDocument();
    expect(screen.queryByText('Set up co-managed IT for this client')).not.toBeInTheDocument();
  });

  it('admitted: client links and the setup entry point are present', async () => {
    actions.overview.mockResolvedValue({ rows: [row()], totalCount: 1 });
    render(<CoManagedOverview initialClientId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect(screen.getByText('View details')).toBeInTheDocument());
    expect(screen.getByText('Set up co-managed IT for this client')).toBeInTheDocument();
    expect(screen.queryByText(/read-only for this workspace/)).not.toBeInTheDocument();
  });

  // Flag-off neutrality: the seat capability closed means the workspace overview as it was, and no seat read.
  it('seat capability closed: the workspace table, the pool line and no combined read', async () => {
    actions.overview.mockResolvedValue({ rows: [row()], totalCount: 1 });
    render(<CoManagedOverview />);
    await waitFor(() => expect(screen.getByText('2 of 5 technician seats')).toBeInTheDocument());
    expect(actions.combined).not.toHaveBeenCalled();
    expect(screen.queryByText('Shape')).not.toBeInTheDocument();
    expect(screen.getByText('3 of 10 co-managed seats allocated.')).toBeInTheDocument();
  });

  // F086
  it('seat capability open: both shapes in one table with seats used and allocated, the pool beside it, no ids', async () => {
    capability.seat = true;
    actions.combined.mockResolvedValue({
      pool: { purchased: 10, allocated: 5, available: 5 }, totalCount: 2,
      rows: [
        { shape: 'seat', clientId: '11111111-1111-4111-8111-111111111111', clientName: 'Acme', state: 'active', seats: 3, usedSeats: 1, relationshipId: null, key: 'a-1' },
        { shape: 'workspace', clientId: '22222222-2222-4222-8222-222222222222', clientName: 'Beta', state: 'active', seats: 2, usedSeats: 2, relationshipId: '33333333-3333-4333-8333-333333333333', key: 'w-1' },
      ],
    });
    const { container } = render(<CoManagedOverview />);
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();
    for (const title of ['Client', 'Shape', 'State', 'Seats used', 'Seats allocated']) expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.getByText('Seat')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Purchased')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(actions.overview).not.toHaveBeenCalled();
    expect(actions.billing).not.toHaveBeenCalled();
    expect((container.textContent ?? '').replace(/href="[^"]*"/g, '')).not.toMatch(UUID);
    expect(screen.getByRole('link', { name: 'Acme' }).getAttribute('href')).toBe('/msp/clients/11111111-1111-4111-8111-111111111111?tab=co-managed');
    expect(screen.getByRole('link', { name: 'Beta' }).getAttribute('href')).toContain('relationshipId=33333333');
  });
});
