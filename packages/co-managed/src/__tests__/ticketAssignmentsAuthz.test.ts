/**
 * Authorization shape of the shared ticket assignment reads. The REAL domain code runs over the in-memory
 * store; the admission wrappers are spies that run the command, and the assignee eligibility check is a
 * stub (it is covered elsewhere and is deliberately unchanged by this card).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const spies = vi.hoisted(() => ({ shared: [] as string[], customer: [] as string[], option: [] as any[] }));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), withTransaction: async (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: async () => undefined, isCoManagedLifecycleError: () => false }));
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, assertCoManagedSessionUnexpired: async () => undefined };
});
const admit = (log: string[]) => (db: any, actor: any, resource: any, action: string, work: (ctx: any) => Promise<any>) => {
  log.push(action);
  return work({ trx: db, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, revision: 1, action, redactedFields: [] });
};
vi.mock('../customerWork', () => ({ withCoManagedCustomerTicket: (...a: [any, any, any, any, any]) => admit(spies.customer)(...a) }));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: (...a: [any, any, any, any, any]) => admit(spies.shared)(...a) }));
vi.mock('../sharedWorkAssignees', () => ({
  coManagedAssigneeOption: async (_ctx: any, assignee: any) => { spies.option.push(assignee); return { ...assignee, name: `Name ${Number(assignee.id.slice(-12))}`, organizationName: 'Sponsor Org' }; },
}));

import { getCoManagedTicketAssignment, listCoManagedTicketAssignees } from '../ticketAssignments';
import { CoManagedSharedWorkError } from '../sharedWorkIdentity';

const C = '11111111-1111-4111-8111-111111111111', S = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333', T = '44444444-4444-4444-8444-444444444444';
const B = '55555555-5555-4555-8555-555555555555', W = '66666666-6666-4666-8666-666666666666';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const resource = { kind: 'ticket' as const, tenant: C, relationshipId: R, id: T };
const actorOf = (tenant: string) => ({ kind: 'session' as const, tenant, userId: uid(999), sessionId: uid(998) }) as any;

let store: FakeStore, db: any;
function seed(assignedTo: string | null = null, users = 0) {
  ({ store, db } = createFake());
  store.seed('co_management_relationships', { tenant: C, relationship_id: R, state: 'active', ended_at: null, sponsor_tenant: S, sponsor_client_id: uid(7), visibility_mode: 'board_scope', escalation_board_id: B });
  store.seed('co_management_ticket_work', { tenant: C, relationship_id: R, ticket_id: T, work_id: W, can_collaborate: true, grant_revoked_at: null, revision: 3 });
  store.seed('co_managed_ticket_references', { tenant: S, reference_id: uid(8), customer_tenant: C, relationship_id: R, ticket_id: T, work_id: W, client_id: uid(7), board_id: B, assigned_to: assignedTo, assigned_team_id: null });
  store.seed('tickets', { tenant: C, ticket_id: T, board_id: B });
  store.seed('boards', { tenant: S, board_id: B, is_inactive: false });
  for (let i = 1; i <= users; i++) store.seed('users', { tenant: S, user_id: uid(i), user_type: 'internal', is_inactive: false });
}
beforeEach(() => { spies.shared.length = 0; spies.customer.length = 0; spies.option.length = 0; });

describe('listCoManagedTicketAssignees', () => {
  it('rejects a customer-side actor before any boundary or directory read', async () => {
    seed(null, 3);
    const reads: string[] = [];
    const tracked = new Proxy(db, { apply: (t, _s, args) => { reads.push(String(args[0])); return t(...(args as [string])); } });
    await expect(listCoManagedTicketAssignees(tracked, actorOf(C), resource, 'user')).rejects.toBeInstanceOf(CoManagedSharedWorkError);
    expect(spies.customer).toEqual([]); expect(spies.shared).toEqual([]); expect(spies.option).toEqual([]);
    expect(reads.filter(table => ['users', 'teams'].includes(table))).toEqual([]);
  });

  it('sponsor-side actor still gets the candidate page and the afterId cursor path, via the shared-work boundary', async () => {
    seed(null, 30);
    const first = await listCoManagedTicketAssignees(db, actorOf(S), resource, 'user');
    expect(spies.shared).toEqual(['update', 'read']); expect(spies.customer).toEqual([]);
    expect(first.options.map(o => o.id)).toEqual(Array.from({ length: 25 }, (_, i) => uid(i + 1)));
    expect(first.nextAfterId).toBe(uid(25));
    const second = await listCoManagedTicketAssignees(db, actorOf(S), resource, 'user', first.nextAfterId!);
    expect(second.options.map(o => o.id)).toEqual(Array.from({ length: 5 }, (_, i) => uid(i + 26)));
    expect(second.nextAfterId).toBeNull();
  });
});

describe('getCoManagedTicketAssignment', () => {
  it('customer side: name and organization only, canAssign false, no principal ids', async () => {
    seed(uid(5));
    const result: any = await getCoManagedTicketAssignment(db, actorOf(C), resource);
    expect(spies.customer.length).toBeGreaterThan(0);
    expect(result).toMatchObject({ canAssign: false, hasAssignment: true, revision: 3 });
    expect(result.mspAssignment).toEqual({ name: "Name 5", organizationName: 'Sponsor Org' });
    expect(JSON.stringify(result.mspAssignment)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(Object.keys(result.mspAssignment).sort()).toEqual(['name', 'organizationName']);
  });

  it('customer side with no assignment: mspAssignment is null and canAssign false', async () => {
    seed(null);
    const result: any = await getCoManagedTicketAssignment(db, actorOf(C), resource);
    expect(result).toMatchObject({ canAssign: false, hasAssignment: false, mspAssignment: null });
  });

  it('sponsor side payload is unchanged: full option with tenant/kind/id and live canAssign', async () => {
    seed(uid(5));
    const result: any = await getCoManagedTicketAssignment(db, actorOf(S), resource);
    expect(result.mspAssignment).toEqual({ tenant: S, kind: 'user', id: uid(5), name: "Name 5", organizationName: 'Sponsor Org' });
    expect(result).toMatchObject({ canAssign: true, canEdit: true, hasAssignment: true, revision: 3 });
  });
});
