// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const actions = vi.hoisted(() => ({ billing: vi.fn(), overview: vi.fn() }));
const capability = vi.hoisted(() => ({ admitted: true }));

vi.mock('@alga-psa/ui/hooks', () => ({
  useCapability: () => ({ enabled: true, admitted: capability.admitted, resolved: true }),
}));

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

beforeEach(() => { capability.admitted = true; actions.billing.mockReset().mockResolvedValue({ allocated: 3, capacity: 10 }); actions.overview.mockReset(); });
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
});
