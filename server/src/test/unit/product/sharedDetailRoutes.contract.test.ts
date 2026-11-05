import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ summary: vi.fn(), session: vi.fn(), gate: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }); },
  notFound: () => { throw Object.assign(new Error('NEXT_NOT_FOUND'), { notFound: true }); },
}));
vi.mock('@alga-psa/auth', async importOriginal => ({ ...(await importOriginal<any>()), getSession: mocks.session }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForPage: mocks.gate }));
vi.mock('@/lib/actions/coManagedWorkActions', () => ({ getCoManagedSharedTicketAction: mocks.summary }));

import ListRedirect from '@/app/msp/co-management/customer-tickets/page';
import DetailRedirect from '@/app/msp/co-management/customer-tickets/[relationshipId]/[ticketId]/page';
import { DEFAULT_CUSTOMER_TICKETS_HREF } from '@/lib/co-managed/ticketListReturn';

const target = async (run: () => unknown) => { try { await run(); } catch (e: any) { return e.to ?? (e.notFound ? 'NOT_FOUND' : Promise.reject(e)); } return 'no-redirect'; };
const params = { relationshipId: 'rel 1', ticketId: 'tk' };

beforeEach(() => {
  mocks.summary.mockReset(); mocks.gate.mockReset(); mocks.session.mockReset();
  mocks.session.mockResolvedValue({ user: { tenant: 'home' } });
  mocks.gate.mockResolvedValue(undefined);
  mocks.summary.mockResolvedValue({ resource: { tenant: 'cust-t', relationshipId: 'rel 1', kind: 'ticket', id: 'tk' } });
});

describe('old co-management routes forward to the new surfaces', () => {
  it('the old list page redirects to the Customer Tickets queue', async () => {
    expect(await target(() => ListRedirect())).toBe(DEFAULT_CUSTOMER_TICKETS_HREF);
  });

  it('the old detail route redirects to the native deep link with the customer tenant resolved server-side', async () => {
    const to = await target(() => DetailRedirect({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }));
    expect(to).toBe('/msp/co-management/tickets/cust-t/rel%201/tk');
    expect(mocks.summary).toHaveBeenCalledWith('rel 1', 'tk');
  });

  it('keeps a valid returnTo and drops an off-site one', async () => {
    const back = '/msp/tickets/customer?queueView=working&workspace=all&page=2';
    const kept = await target(() => DetailRedirect({ params: Promise.resolve(params), searchParams: Promise.resolve({ returnTo: back }) }));
    expect(kept).toContain('/msp/co-management/tickets/cust-t/rel%201/tk?returnTo=');
    expect(decodeURIComponent(kept.split('returnTo=')[1])).toContain('page=2');
    const dropped = await target(() => DetailRedirect({ params: Promise.resolve(params), searchParams: Promise.resolve({ returnTo: 'https://evil.example/x' }) }));
    expect(dropped).toBe('/msp/co-management/tickets/cust-t/rel%201/tk');
  });

  it('an unreadable ticket is a 404, not a redirect that confirms it exists', async () => {
    mocks.summary.mockResolvedValue(null);
    expect(await target(() => DetailRedirect({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }))).toBe('NOT_FOUND');
  });

  it('the capability gate runs before the read', async () => {
    mocks.gate.mockRejectedValue(new Error('closed'));
    await expect(DetailRedirect({ params: Promise.resolve(params), searchParams: Promise.resolve({}) })).rejects.toThrow('closed');
    expect(mocks.summary).not.toHaveBeenCalled();
  });
});
