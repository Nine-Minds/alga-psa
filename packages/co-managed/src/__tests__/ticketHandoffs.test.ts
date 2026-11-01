/**
 * Behavioural tests for the ticket handoff state machine. The REAL transition code runs over the
 * in-memory store. Mocked: the DB wiring, the admission wrappers (customerWork / sharedWork, replaced
 * by a per-ticket mutex that stands in for the admission wrapper's ticket FOR UPDATE), policy lock,
 * session checks, participation evidence, and the licence gate.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const gate = vi.hoisted(() => ({ paused: false, evidence: [] as any[], chains: new Map<string, Promise<unknown>>(), clock: 0 }));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  const appendOnly = new Set(['co_management_ticket_handoffs', 'co_management_command_receipts']);
  return {
    tenantDb: (db: any, tenant: string) => {
      const inner = fake.fakeTenantDb(db, tenant);
      return { ...inner, table: (name: string) => {
        const builder = inner.table(name);
        if (appendOnly.has(name)) {
          builder.update = () => { throw new Error(`append-only violation: update ${name}`); };
          builder.del = () => { throw new Error(`append-only violation: del ${name}`); };
        }
        return builder;
      } };
    },
    withTransaction: async (db: any, work: any) => db.transaction(work),
  };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({
  assertCoManagedOperationalWrite: async () => { if (gate.paused) throw new Error('LICENSE_PAUSED'); },
}));
vi.mock('../participationEvidence', () => ({
  retainCoManagedBeforeAccessReduction: async (ctx: any) => { gate.evidence.push({ before: ctx }); },
  retainCoManagedParticipationEvidence: async (_c: any, source: string, id: string) => { gate.evidence.push({ source, id }); },
}));
vi.mock('../policy', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { lockCoManagedCustomerPolicy: async (trx: any, _actor: any, target: any) => {
    const customer = fake.fakeTenantDb(trx, target.customerTenant);
    const relationship = await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).first();
    return { customer, relationship };
  } };
});
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, assertCoManagedSessionUnexpired: async () => undefined, lockCoManagedSessionIdentity: async () => ({}) };
});
/** Serialise per ticket like the admission wrapper's ticket FOR UPDATE does. */
async function admit(db: any, actor: any, resource: any, work: (ctx: any) => Promise<any>) {
  const key = `${resource.tenant}:${resource.id}`;
  const previous = gate.chains.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => db.transaction((trx: any) =>
    work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, revision: 1, action: 'update', redactedFields: [] })));
  gate.chains.set(key, run.catch(() => undefined));
  return run;
}
vi.mock('../customerWork', () => ({ withCoManagedCustomerTicket: (db: any, actor: any, resource: any, _a: string, work: any) => admit(db, actor, resource, work) }));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: (db: any, actor: any, resource: any, _a: string, work: any) => admit(db, actor, resource, work) }));

import { coManagedHandoffFingerprint, escalateCoManagedTicket, handBackCoManagedTicket, revokeCoManagedTicketGrant,
  CoManagedTicketHandoffError } from '../ticketHandoffs';

const C = '00000000-0000-4000-8000-0000000000c1', S = '00000000-0000-4000-8000-0000000000a1';
const REL = '00000000-0000-4000-8000-0000000000e1', TICKET = '00000000-0000-4000-8000-0000000000f1';
const BOARD = '00000000-0000-4000-8000-0000000000b1', SCLIENT = '00000000-0000-4000-8000-0000000000d1';
const CUSER = '00000000-0000-4000-8000-0000000000c2', SUSER = '00000000-0000-4000-8000-0000000000a2';
const SESSION = '00000000-0000-4000-8000-0000000000aa';
const customer = { kind: 'session', tenant: C, userId: CUSER, sessionId: SESSION } as const;
const msp = { kind: 'session', tenant: S, userId: SUSER, sessionId: SESSION } as const;
const resource = { tenant: C, relationshipId: REL, kind: 'ticket', id: TICKET } as const;
let n = 0;
const op = () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const req = (expectedRevision: number, note = 'Please look at this', operationId = op()) => ({ operationId, expectedRevision, note });

let store: FakeStore, db: any;
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => e instanceof CoManagedTicketHandoffError ? e.code : `other:${e.message}`);
const work = () => store.rows('co_management_ticket_work').find(r => r.ticket_id === TICKET);

beforeEach(() => {
  ({ store, db } = createFake());
  gate.paused = false; gate.evidence = []; gate.chains.clear(); gate.clock = 0;
  db.select = () => ({ first: async () => ({ at: new Date(Date.UTC(2026, 9, 27, 0, 0, ++gate.clock)) }) });
  store.seed('co_management_relationships', { tenant: C, relationship_id: REL, sponsor_tenant: S, sponsor_client_id: SCLIENT, escalation_board_id: BOARD, revision: 1 });
  store.seed('tickets', { tenant: C, ticket_id: TICKET });
  store.seed('boards', { tenant: S, board_id: BOARD, is_inactive: false });
  store.seed('clients', { tenant: S, client_id: SCLIENT });
  store.seed('users', { tenant: C, user_id: CUSER, first_name: 'Cara', last_name: 'Customer' }, { tenant: S, user_id: SUSER, first_name: 'Max', last_name: 'Msp' });
  store.seed('tenants', { tenant: C, client_name: 'Customer Co' }, { tenant: S, client_name: 'MSP Co' });
});

describe('transitions', () => {
  it('escalates: work row, handoff history, reference row, shared note', async () => {
    const r = await escalateCoManagedTicket(db, customer, resource, req(0, '  Need help  '));
    expect(r).toMatchObject({ appliedRevision: 1, transition: 'escalated' });
    expect(work()).toMatchObject({ revision: 1, responsibility: 'msp', can_collaborate: true });
    const [h] = store.rows('co_management_ticket_handoffs');
    expect(h).toMatchObject({ tenant: C, revision: 1, transition: 'escalated', note: 'Need help', audience: 'shared_it',
      actor_name: 'Cara Customer', actor_organization: 'Customer Co', operation_id: r.operationId });
    expect(store.rows('co_managed_ticket_references')).toEqual([expect.objectContaining({
      tenant: S, customer_tenant: C, relationship_id: REL, ticket_id: TICKET, work_id: work()!.work_id, client_id: SCLIENT, board_id: BOARD })]);
    expect(gate.evidence).toContainEqual({ source: 'ticket_handoff', id: r.operationId });
  });

  it('hands back msp -> customer, keeping grant and reference', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    const r = await handBackCoManagedTicket(db, msp, resource, req(1, 'Done'));
    expect(r).toMatchObject({ appliedRevision: 2, transition: 'handed_back' });
    expect(work()).toMatchObject({ responsibility: 'customer', revision: 2, can_collaborate: true });
    expect(work()!.grant_revoked_at).toBeUndefined();
    expect(store.rows('co_managed_ticket_references')[0]).toMatchObject({ assigned_to: null, assigned_team_id: null });
    expect(store.rows('co_management_ticket_handoffs')[1]).toMatchObject({ actor_tenant: S, actor_name: 'Max Msp' });
  });

  it('lets the customer take back (same handed_back transition, customer-side admission)', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    const r = await handBackCoManagedTicket(db, customer, resource, req(1, 'Taking back'));
    expect(r.transition).toBe('handed_back');
    expect(work()).toMatchObject({ responsibility: 'customer', revision: 2 });
    expect(store.rows('co_management_ticket_handoffs')[1]).toMatchObject({ actor_tenant: C, actor_user_id: CUSER });
  });

  it('revokes the grant, and does so while the licence is paused', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    gate.paused = true;
    const r = await revokeCoManagedTicketGrant(db, customer, resource, req(1, 'Revoke'));
    expect(r).toMatchObject({ appliedRevision: 2, transition: 'access_revoked' });
    expect(work()).toMatchObject({ responsibility: 'customer', can_collaborate: false });
    expect(work()!.grant_revoked_at).toBeInstanceOf(Date);
    expect(gate.evidence.some(e => e.before)).toBe(true);
  });

  it('refuses escalate and hand back while the licence is paused, writing nothing', async () => {
    gate.paused = true;
    const before = structuredClone(store.tables);
    await expect(escalateCoManagedTicket(db, customer, resource, req(0))).rejects.toThrow('LICENSE_PAUSED');
    expect(store.tables).toEqual(before);
    gate.paused = false;
    await escalateCoManagedTicket(db, customer, resource, req(0));
    gate.paused = true;
    const mid = structuredClone(store.tables);
    await expect(handBackCoManagedTicket(db, msp, resource, req(1))).rejects.toThrow('LICENSE_PAUSED');
    expect(store.tables).toEqual(mid);
  });

  it('re-escalation after revoke is a new explicit grant', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    await revokeCoManagedTicketGrant(db, customer, resource, req(1));
    expect(await code(escalateCoManagedTicket(db, customer, resource, req(2)))).toBe('ok');
    expect(work()).toMatchObject({ revision: 3, responsibility: 'msp', grant_revoked_at: null, can_collaborate: true });
  });
});

describe('refusals', () => {
  it('stale expectedRevision => HANDOFF_CHANGED', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    expect(await code(handBackCoManagedTicket(db, msp, resource, req(0)))).toBe('HANDOFF_CHANGED');
    expect(await code(handBackCoManagedTicket(db, msp, resource, req(5)))).toBe('HANDOFF_CHANGED');
  });
  it('escalating an already-msp ticket => ALREADY_RESPONSIBLE', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    expect(await code(escalateCoManagedTicket(db, customer, resource, req(1)))).toBe('ALREADY_RESPONSIBLE');
  });
  it('inactive destination board, or missing client => DESTINATION_UNAVAILABLE, nothing written', async () => {
    store.rows('boards')[0].is_inactive = true;
    expect(await code(escalateCoManagedTicket(db, customer, resource, req(0)))).toBe('DESTINATION_UNAVAILABLE');
    expect(store.rows('co_management_ticket_work')).toHaveLength(0);
    store.rows('boards')[0].is_inactive = false; store.tables.clients = [];
    expect(await code(escalateCoManagedTicket(db, customer, resource, req(0)))).toBe('DESTINATION_UNAVAILABLE');
  });
  it('refuses every illegal transition', async () => {
    // no work row yet: hand back is "already customer", revoke has nothing to revoke
    expect(await code(handBackCoManagedTicket(db, customer, resource, req(0)))).toBe('ALREADY_RESPONSIBLE');
    expect(await code(revokeCoManagedTicketGrant(db, customer, resource, req(0)))).toBe('HANDOFF_CHANGED');
    await escalateCoManagedTicket(db, customer, resource, req(0));
    await handBackCoManagedTicket(db, msp, resource, req(1));
    // customer-responsible: hand back again refused
    expect(await code(handBackCoManagedTicket(db, customer, resource, req(2)))).toBe('ALREADY_RESPONSIBLE');
    await revokeCoManagedTicketGrant(db, customer, resource, req(2));
    expect(await code(revokeCoManagedTicketGrant(db, customer, resource, req(3)))).toBe('ALREADY_REVOKED');
    expect(await code(handBackCoManagedTicket(db, msp, resource, req(3)))).toBe('ALREADY_RESPONSIBLE');
    expect(await code(escalateCoManagedTicket(db, customer, resource, req(2)))).toBe('HANDOFF_CHANGED');
    expect(work()).toMatchObject({ revision: 3 });
  });
  it('rejects malformed requests', async () => {
    for (const bad of [{ ...req(0), operationId: 'nope' }, req(-1), req(1.5), req(0, '   '), req(0, 'x\0y'), req(0, 'x'.repeat(10001))])
      expect(await code(escalateCoManagedTicket(db, customer, resource, bad))).toBe('INVALID_HANDOFF');
  });
  it('a wrong-tenant actor is refused by the relationship check', async () => {
    const stranger = { ...msp, tenant: '00000000-0000-4000-8000-0000000000ee' };
    expect(await code(handBackCoManagedTicket(db, stranger, resource, req(0)))).toMatch(/other:/);
  });
});

describe('idempotency and fingerprint', () => {
  it('replays a byte-identical receipt and writes nothing, even after later transitions', async () => {
    const request = req(0);
    const first = await escalateCoManagedTicket(db, customer, resource, request);
    let before = structuredClone(store.tables);
    const replay = await escalateCoManagedTicket(db, customer, resource, { ...request });
    expect(JSON.stringify(replay)).toBe(JSON.stringify(first));
    expect(store.tables).toEqual(before);
    await handBackCoManagedTicket(db, msp, resource, req(1));
    before = structuredClone(store.tables);
    expect(JSON.stringify(await escalateCoManagedTicket(db, customer, resource, request))).toBe(JSON.stringify(first));
    expect(store.tables).toEqual(before);
  });
  it('a different note or expectedRevision under the same operationId => HANDOFF_CHANGED', async () => {
    const request = req(0);
    await escalateCoManagedTicket(db, customer, resource, request);
    const before = structuredClone(store.tables);
    expect(await code(escalateCoManagedTicket(db, customer, resource, { ...request, note: 'different' }))).toBe('HANDOFF_CHANGED');
    expect(await code(escalateCoManagedTicket(db, customer, resource, { ...request, expectedRevision: 1 }))).toBe('HANDOFF_CHANGED');
    expect(await code(handBackCoManagedTicket(db, msp, resource, request))).toBe('HANDOFF_CHANGED'); // other transition/actor
    expect(store.tables).toEqual(before);
  });
  it('fingerprint covers actor, resource, transition and request; excludes mutable state', () => {
    const r = req(0, 'n', 'op-1');
    const base = coManagedHandoffFingerprint(customer, resource, 'escalated', r);
    const same = coManagedHandoffFingerprint({ tenant: C, userId: CUSER, sessionId: 'other' } as any,
      { ...resource, revision: 99, status: 'x' } as any, 'escalated', { ...r, stateRevision: 7 } as any);
    expect(same).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    const variants = [
      coManagedHandoffFingerprint({ tenant: C, userId: SUSER }, resource, 'escalated', r),
      coManagedHandoffFingerprint({ tenant: S, userId: CUSER }, resource, 'escalated', r),
      coManagedHandoffFingerprint(customer, { ...resource, id: REL }, 'escalated', r),
      coManagedHandoffFingerprint(customer, { ...resource, relationshipId: TICKET }, 'escalated', r),
      coManagedHandoffFingerprint(customer, resource, 'handed_back', r),
      coManagedHandoffFingerprint(customer, resource, 'escalated', { ...r, expectedRevision: 1 }),
      coManagedHandoffFingerprint(customer, resource, 'escalated', { ...r, note: 'm' }),
      coManagedHandoffFingerprint(customer, resource, 'escalated', { ...r, operationId: 'op-2' }),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });
});

describe('structure', () => {
  it('never updates or deletes the append-only handoff and receipt tables', async () => {
    // Runtime: the tenantDb mock throws on update/del for those tables; a full lifecycle must pass.
    await escalateCoManagedTicket(db, customer, resource, req(0));
    await handBackCoManagedTicket(db, msp, resource, req(1));
    await escalateCoManagedTicket(db, customer, resource, req(2));
    await revokeCoManagedTicketGrant(db, customer, resource, req(3));
    expect(store.rows('co_management_ticket_handoffs')).toHaveLength(4);
    // Static: no chained update/del/delete on them in the source.
    const src = readFileSync(new URL('../ticketHandoffs.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/co_management_(ticket_handoffs|command_receipts)'\)[^;]*\.(update|del|delete|truncate)\(/);
  });
  it('locks the work row for update; destination board/client for share only on escalate', async () => {
    await escalateCoManagedTicket(db, customer, resource, req(0));
    expect(store.locks).toContain(`${C}:co_management_ticket_work:update`);
    expect(store.locks).toContain(`${S}:co_managed_ticket_references:update`);
    expect(store.locks).toContain(`${S}:boards:share`);
    expect(store.locks).toContain(`${S}:clients:share`);
    store.locks.length = 0;
    await handBackCoManagedTicket(db, msp, resource, req(1));
    await revokeCoManagedTicketGrant(db, customer, resource, req(2));
    expect(store.locks).toContain(`${C}:co_management_ticket_work:update`);
    expect(store.locks.filter(l => l.endsWith(':share'))).toEqual([]);
  });
  it('two racing transitions from the same revision: exactly one wins, the other gets HANDOFF_CHANGED', async () => {
    // The fake cannot lock rows; the admission mock serialises per ticket exactly as the real
    // wrapper's ticket FOR UPDATE does, so the loser re-reads the winner's revision.
    // (revoke bypasses admit() via withTransaction, so use two admitted hand-backs instead.)
    await escalateCoManagedTicket(db, customer, resource, req(0));
    const results = await Promise.all([
      handBackCoManagedTicket(db, msp, resource, req(1)),
      handBackCoManagedTicket(db, customer, resource, req(1)),
    ].map(code));
    expect(results.filter(r => r === 'ok')).toHaveLength(1);
    expect(results.filter(r => r === 'HANDOFF_CHANGED')).toHaveLength(1);
    expect(work()!.revision).toBe(2);
    expect(store.rows('co_management_ticket_handoffs')).toHaveLength(2);
  });
});
