import { beforeEach, describe, expect, it, vi } from 'vitest';

// alga-2026-0003007: customer recipients captured in the routing outbox are re-authorized when delivered.
const h = vi.hoisted(() => ({
  data: {} as Record<string, any[]>,
  queries: [] as string[],
  authorize: vi.fn(async (_: any) => ({})),
  sponsor: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', () => {
  const builder = (table: string, rows: any[]) => {
    let result = rows;
    const q: any = {
      where(c: any) { if (typeof c === 'object') result = result.filter((r) => Object.entries(c).every(([k, v]) => r[k] === v)); return q; },
      whereIn(col: string, vals: any[]) { result = result.filter((r) => (vals as any[]).includes(r[col])); return q; },
      orderBy() { return q; }, limit() { return q; },
      first() { return Promise.resolve(result[0]); },
      then(res: any, rej: any) { h.queries.push(table); return Promise.resolve(result).then(res, rej); },
    };
    return q;
  };
  return {
    withAdminTransaction: async (fn: any) => fn({}),
    tenantDb: () => ({ table: (t: string) => builder(t, h.data[t] ?? []) }),
  };
});
vi.mock('../sharedWork', () => ({ withCoManagedNotificationRecipient: (...a: any[]) => (h.sponsor as any)(...a) }));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: (i: any) => h.authorize(i) }));
vi.mock('@alga-psa/shared/lib/deliveryLedger', () => ({ claimDelivery: vi.fn(), finishDelivery: vi.fn(), CO_MANAGED_LEDGER: {} }));

import { createCoManagedDeliveryProvider } from '../deliveryProvider';

const tenant = 't1', ticketId = 'tk1', user = 'u1';
const payload = (principalId: string) => ({ ticketId, principalId, event: 'escalation_returned', actorName: 'Ann', actorOrganization: 'MSP', sponsorTenant: 's1', relationshipId: 'r1' });
const row = (kind: string, recipient: string, recipient_kind: string, principalId: string) =>
  ({ delivery_kind: kind, source_id: 'op1', recipient, recipient_kind, state: 'pending', payload: payload(principalId), created_at: 0 });

function seed(over: { user?: any; assignedTo?: string | null } = {}) {
  h.data = {
    co_management_deliveries: [
      row('routing_in_app', user, 'customer_user', user),
      row('routing_email', 'old@example.test', 'customer_user', user),
    ],
    tickets: [{ ticket_id: ticketId, ticket_number: 'T-1', title: 'Printer', assigned_to: 'assignedTo' in over ? over.assignedTo : user }],
    users: [over.user === null ? undefined : { user_id: user, email: 'New@Example.test', is_inactive: false, user_type: 'internal', ...over.user }].filter(Boolean),
  };
}
const run = () => createCoManagedDeliveryProvider().pendingRouting(tenant);

describe('pendingRouting re-authorizes customer recipients', () => {
  beforeEach(() => { h.queries.length = 0; h.authorize.mockReset(); h.authorize.mockResolvedValue({}); h.sponsor.mockReset(); });

  it('still-authorized assignee: both allowed, email goes to the CURRENT address, ledger key stays the stored recipient', async () => {
    seed();
    const [inApp, email] = await run();
    expect(inApp).toMatchObject({ allowed: true, ledgerRecipient: user, recipient: { principalId: user } });
    expect(email).toMatchObject({ allowed: true, ledgerRecipient: 'old@example.test', recipient: { email: 'new@example.test' } });
  });

  it.each([
    ['deactivated', { user: { is_inactive: true } }],
    ['deleted', { user: null }],
    ['reassigned', { assignedTo: 'someone-else' }],
    ['unassigned', { assignedTo: null }],
  ])('%s: both rows skipped', async (_n, over) => {
    seed(over as any);
    const out = await run();
    expect(out.map((d) => d.allowed)).toEqual([false, false]);
    expect(out[1].ledgerRecipient).toBe('old@example.test');
  });

  it('read authorization revoked: skipped; unexpected errors still propagate', async () => {
    seed();
    h.authorize.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));
    expect((await run()).map((d) => d.allowed)).toEqual([false, false]);
    h.authorize.mockRejectedValue(new Error('connection reset'));
    await expect(run()).rejects.toThrow('connection reset');
  });

  it('no current email: only the email row is skipped (in-app/email outcomes are independent)', async () => {
    seed({ user: { email: null } });
    expect((await run()).map((d) => d.allowed)).toEqual([true, false]);
  });

  it('loads customer users once per batch, not per row', async () => {
    seed();
    await run();
    expect(h.queries.filter((t) => t === 'users')).toHaveLength(1);
  });

  it('sponsor rows keep the sponsor path: no customer user lookup, captured address, sponsor check only', async () => {
    seed();
    h.data.co_management_deliveries = [row('routing_email', 'msp@example.test', 'msp_user', 'm1')];
    h.data.users = [];
    const [d] = await run();
    expect(h.sponsor).toHaveBeenCalledTimes(1);
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.queries).not.toContain('users');
    expect(d).toMatchObject({ allowed: true, recipient: { email: 'msp@example.test', principalId: 'm1' }, recipientTenant: 's1' });
  });
});
