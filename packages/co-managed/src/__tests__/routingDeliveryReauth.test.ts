import { beforeEach, describe, expect, it, vi } from 'vitest';

// alga-2026-0003007: customer recipients captured in the routing outbox are re-authorized when delivered.
const h = vi.hoisted(() => ({
  data: {} as Record<string, any[]>,
  queries: [] as string[],
  authorize: vi.fn(async (_: any) => ({})),
  sponsor: vi.fn(async (_db: any, _user: any, _resource: any, deliver: any) => deliver({ redactedFields: ['tickets.title', 'comments.content'] })),
  rbac: vi.fn(async (..._a: any[]) => true),
}));

vi.mock('@alga-psa/db', () => {
  const builder = (table: string, rows: any[]) => {
    let result = rows;
    const q: any = {
      where(c: any, val?: any) { const cond = typeof c === 'object' ? c : { [c]: val };
        result = result.filter((r) => Object.entries(cond).every(([k, v]) => r[k] === v || r[k.split('.').at(-1)!] === v)); return q; },
      whereNull(col: string) { result = result.filter((r) => r[col] == null); return q; },
      whereIn(col: string, vals: any[]) { result = result.filter((r) => (vals as any[]).includes(r[col])); return q; },
      count: async () => [{ count: '0' }], select() { return q; },
      orderBy() { return q; }, limit() { return q; },
      first() { return Promise.resolve(result[0]); },
      then(res: any, rej: any) { h.queries.push(table); return Promise.resolve(result).then(res, rej); },
    };
    return q;
  };
  return {
    withAdminTransaction: async (fn: any) => fn({}),
    tenantDb: () => ({ table: (t: string) => builder(t, h.data[t] ?? []), tenantJoin: () => undefined }),
  };
});
vi.mock('../sharedWork', () => ({ withCoManagedNotificationRecipient: (...a: any[]) => (h.sponsor as any)(...a) }));
vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccess: (i: any) => h.authorize(i) }));
vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: (...a: any[]) => h.rbac(...a) }));
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
  beforeEach(() => { h.queries.length = 0; h.authorize.mockReset(); h.authorize.mockResolvedValue({}); h.sponsor.mockReset(); h.sponsor.mockImplementation(async (_db: any, _user: any, _resource: any, deliver: any) => deliver({ redactedFields: ['tickets.title', 'comments.content'] })); h.rbac.mockReset(); h.rbac.mockResolvedValue(true); });

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

  it('RBAC denies ticket:read: both rows skipped and the record authorizer is never called', async () => {
    seed();
    h.rbac.mockResolvedValue(false);
    expect((await run()).map((d) => d.allowed)).toEqual([false, false]);
    expect(h.rbac).toHaveBeenCalledWith({ user_id: user, user_type: 'internal', tenant }, 'ticket', 'read', expect.anything());
    expect(h.authorize).not.toHaveBeenCalled();
  });

  it('RBAC allows but the record check denies: skipped', async () => {
    seed();
    h.authorize.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));
    expect((await run()).map((d) => d.allowed)).toEqual([false, false]);
    expect(h.rbac).toHaveBeenCalled();
    expect(h.authorize).toHaveBeenCalled();
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

  it('sponsor rows use the current active address and carry a fresh per-recipient projection while retaining the original ledger key', async () => {
    seed();
    h.data.co_management_deliveries = [row('routing_email', 'old-msp@example.test', 'msp_user', 'm1')];
    h.data.users = [{ user_id: 'm1', email: ' Current-MSP@Example.test ', user_type: 'internal', is_inactive: false }];
    const [d] = await run();
    expect(h.sponsor).toHaveBeenCalledTimes(1);
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.queries.filter((t) => t === 'users')).toHaveLength(1);
    expect(d).toMatchObject({ allowed: true, ledgerRecipient: 'old-msp@example.test', recipient: { email: 'current-msp@example.test', principalId: 'm1', redactedFields: ['tickets.title', 'comments.content'] }, recipientTenant: 's1' });
  });

  it.each([
    ['inactive', { is_inactive: true }],
    ['missing address', { email: null }],
    ['non-internal', { user_type: 'client' }],
  ])('sponsor %s identity cannot receive email', async (_case, userRow) => {
    seed();
    h.data.co_management_deliveries = [row('routing_email', 'old-msp@example.test', 'msp_user', 'm1')];
    h.data.users = [{ user_id: 'm1', email: 'current@example.test', user_type: 'internal', is_inactive: false, ...userRow }];
    const [d] = await run();
    expect(d.allowed).toBe(false);
    expect(d.ledgerRecipient).toBe('old-msp@example.test');
  });

  it('does not email a missing sponsor identity and retains the captured routing ledger address', async () => {
    seed();
    h.data.co_management_deliveries = [row('routing_email', 'old-msp@example.test', 'msp_user', 'missing-msp')];
    h.data.users = [];
    const [d] = await run();
    expect(d).toMatchObject({ allowed: false, ledgerRecipient: 'old-msp@example.test', recipient: { principalId: 'missing-msp' } });
    expect(h.sponsor).not.toHaveBeenCalled();
  });

  it('re-evaluates sponsor redactions independently on each recovery attempt', async () => {
    seed();
    h.data.co_management_deliveries = [row('routing_in_app', 'm1', 'msp_user', 'm1')];
    h.data.users = [{ user_id: 'm1', email: 'msp@example.test', user_type: 'internal', is_inactive: false }];
    h.sponsor.mockImplementationOnce(async (_db: any, _user: any, _resource: any, deliver: any) => deliver({ redactedFields: ['tickets.title'] }));
    h.sponsor.mockImplementationOnce(async (_db: any, _user: any, _resource: any, deliver: any) => deliver({ redactedFields: ['comments.content'] }));
    const [first] = await run();
    const [retry] = await run();
    expect(first.recipient.redactedFields).toEqual(['tickets.title']);
    expect(retry.recipient.redactedFields).toEqual(['comments.content']);
  });

  it('projects different routing content for two sponsor principals on the same ticket', async () => {
    seed();
    h.data.co_management_deliveries = [
      row('routing_in_app', 'm1', 'msp_user', 'm1'),
      row('routing_in_app', 'm2', 'msp_user', 'm2'),
    ];
    h.data.users = [
      { user_id: 'm1', email: 'one@example.test', user_type: 'internal', is_inactive: false },
      { user_id: 'm2', email: 'two@example.test', user_type: 'internal', is_inactive: false },
    ];
    h.sponsor.mockImplementation(async (_db: any, input: any, _resource: any, deliver: any) => deliver({
      redactedFields: input.userId === 'm1' ? ['tickets.title'] : ['assignee_name'],
    }));
    const deliveries = await run();
    expect(deliveries.map((d) => d.recipient.redactedFields)).toEqual([['tickets.title'], ['assignee_name']]);
  });
});

describe('sponsor comment retry authorization', () => {
  it('resolves an assigned team member through the production provider plan and reauthorization methods', async () => {
    h.data = {
      co_management_ticket_work: [{ ticket_id: 'tk1', relationship_id: 'rel', grant_revoked_at: null, first_escalated_at: new Date() }],
      co_management_relationships: [{ relationship_id: 'rel', sponsor_tenant: 's1', state: 'active', ended_at: null }],
      co_management_ticket_handoffs: [],
      co_managed_ticket_references: [{ relationship_id: 'rel', ticket_id: 'tk1', customer_tenant: 't1', assigned_team_id: 'team1' }],
      comments: [{ comment_id: 'c1', thread_id: 'th1', is_internal: false }],
      comment_threads: [{ thread_id: 'th1', collaboration_audience: 'shared_it', is_internal: true }],
      'team_members as tm': [{ team_id: 'team1', user_id: 'principal', email: 'team@example.test', user_type: 'internal', is_inactive: false }],
    };
    const provider = createCoManagedDeliveryProvider();
    const result = await provider.reauthorizeCommentRecipient!({ tenant: 't1', ticketId: 'tk1', commentId: 'c1', relationshipId: 'rel', sponsorTenant: 's1', principalId: 'principal' });
    expect(result).toMatchObject({ kind: 'team', principalId: 'principal', email: 'team@example.test' });
  });

  it.each(['msp_user', 'team'] as const)('retains currently authorized %s participants through the production provider method', async kind => {
    const realProvider = createCoManagedDeliveryProvider();
    const plan = { audience: 'shared_it' as const, threadId: 'thread', relationshipId: 'rel', sponsorTenant: 's1',
      sponsorRecipients: [{ kind, principalId: 'principal', email: 'now@example.test', redactedFields: ['note'] }],
      replyTokenMetadata: { namespace: 'cm' as const, version: 2 as const, relationshipId: 'rel', grantGeneration: 0, threadId: 'thread' } };
    vi.spyOn(realProvider, 'planTicketComment').mockResolvedValue(plan);
    await expect(realProvider.reauthorizeCommentRecipient!({ tenant: 't1', ticketId: 'tk1', commentId: 'c1', relationshipId: 'rel', sponsorTenant: 's1', principalId: 'principal' }))
      .resolves.toEqual(plan.sponsorRecipients[0]);
  });
});
