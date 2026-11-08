/**
 * Path test for the organization SLA clock: the REAL ticketHandoffs transition -> dispatchTicketLifecycle ->
 * the REGISTERED co-managed handler -> applyCoManagedTicketSlaTransition -> the store's persisted clock.
 * Mocked: admission wrappers, policy lock, session checks, evidence, licence gate, capability gate, policy
 * resolution and the SQL store (replaced by an in-memory one that runs the real pure clock reducers and the
 * store's operation-id idempotency; the real store is covered by the Postgres integration run).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const ctx = vi.hoisted(() => ({ store: null as any, now: 0, chains: new Map<string, Promise<unknown>>() }));
const ALWAYS = { timezone: 'UTC', is_24x7: true, entries: [] };

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), withTransaction: async (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/core/capability', () => ({ serves: async () => ({ served: true }) }));
vi.mock('@alga-psa/licensing/lifecycle', () => ({
  assertCoManagedOperationalWrite: async () => undefined,
  getCoManagedOperationalState: async () => ({ canWrite: true, state: 'active' }),
}));
vi.mock('../participationEvidence', () => ({
  retainCoManagedBeforeAccessReduction: async () => undefined, retainCoManagedParticipationEvidence: async () => undefined,
}));
vi.mock('../policy', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { lockCoManagedCustomerPolicy: async (trx: any, _a: any, target: any) => {
    const customer = fake.fakeTenantDb(trx, target.customerTenant);
    return { customer, relationship: await customer.table('co_management_relationships').where('relationship_id', target.relationshipId).first() };
  } };
});
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, assertCoManagedSessionUnexpired: async () => undefined, lockCoManagedSessionIdentity: async () => ({}) };
});
async function admit(db: any, actor: any, resource: any, work: (c: any) => Promise<any>) {
  return db.transaction((trx: any) => work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource,
    revision: 1, action: 'update', redactedFields: [] }));
}
vi.mock('../customerWork', () => ({ withCoManagedCustomerTicket: (db: any, a: any, r: any, _x: string, w: any) => admit(db, a, r, w) }));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: (db: any, a: any, r: any, _x: string, w: any) => admit(db, a, r, w) }));
vi.mock('@alga-psa/shared/lib/sla/organizationSlaLock', () => ({ acquireOrganizationSlaLock: async () => undefined }));
vi.mock('@alga-psa/shared/lib/sla/organizationSlaNotifications', () => ({
  pendingOrganizationSlaNotifications: async () => [], captureOrganizationSlaNotifications: async () => undefined,
}));
vi.mock('@alga-psa/shared/lib/sla/slaPolicyResolver', () => ({
  resolveSlaPolicy: async () => ({ sla_policy_id: '00000000-0000-4000-8000-000000000153' }),
  getBusinessHoursSchedule: async () => ({ timezone: 'UTC', is_24x7: true, entries: [] }),
}));
vi.mock('@alga-psa/shared/lib/sla/organizationSlaStore', async () => {
  const clockLib = await vi.importActual<typeof import('@alga-psa/shared/lib/sla/organizationSlaClock')>('@alga-psa/shared/lib/sla/organizationSlaClock');
  const rows = (name: string) => ctx.store.rows(name) as any[];
  const reduce: Record<string, (c: any, e: any) => any> = {
    observed: (c, e) => clockLib.observeOrganizationSlaClock(c, e.occurredAt),
    paused: (c, e) => clockLib.pauseOrganizationSlaClock(c, e.reason, e.occurredAt),
    resumed: (c, e) => clockLib.resumeOrganizationSlaClock(c, e.reason, e.occurredAt),
    responded: (c, e) => clockLib.respondToOrganizationSlaClock(c, e, e.occurredAt),
    resolved: (c, e) => clockLib.resolveOrganizationSlaClock(c, e.occurredAt),
  };
  return {
    startOrganizationSlaObligation: async (_trx: any, identity: any, operationId: string, input: any) => {
      const prior = rows('sla_organization_events').find(r => r.operation_id === operationId && r.obligation_id === identity.obligationId);
      if (prior) return { obligationId: prior.obligation_id, operationId, revision: prior.revision, event: 'started', occurredAt: prior.occurred_at, deduplicated: true };
      const active = rows('sla_organization_obligations').find(r => r.source_tenant === identity.sourceTenant && r.ticket_id === identity.ticketId && !r.clock.resolution.completedAt);
      if (active) return { obligationId: active.obligation_id, operationId, revision: active.revision, event: 'started', occurredAt: active.created_at, deduplicated: true };
      const clock = clockLib.startOrganizationSlaClock(identity, input.schedule, input.targets, input.occurredAt);
      rows('sla_organization_obligations').push({ tenant: identity.tenant, obligation_id: identity.obligationId, source_tenant: identity.sourceTenant,
        ticket_id: identity.ticketId, work_id: input.workId, generation: input.generation, revision: 1, clock, created_at: clock.startedAt });
      rows('sla_organization_events').push({ tenant: identity.tenant, obligation_id: identity.obligationId, operation_id: operationId, revision: 1,
        event_type: 'started', occurred_at: clock.startedAt });
      return { obligationId: identity.obligationId, operationId, revision: 1, event: 'started', occurredAt: clock.startedAt };
    },
    applyOrganizationSlaEvent: async (_trx: any, identity: any, operationId: string, event: any) => {
      const prior = rows('sla_organization_events').find(r => r.operation_id === operationId && r.obligation_id === identity.obligationId);
      if (prior) return { obligationId: prior.obligation_id, operationId, revision: prior.revision, event: prior.event_type, occurredAt: prior.occurred_at, deduplicated: true };
      const row = rows('sla_organization_obligations').find(r => r.obligation_id === identity.obligationId);
      if (!row) throw new Error('Organization SLA obligation does not exist');
      row.clock = reduce[event.kind](row.clock, event); row.revision += 1;
      rows('sla_organization_events').push({ tenant: identity.tenant, obligation_id: identity.obligationId, operation_id: operationId,
        revision: row.revision, event_type: event.kind, occurred_at: row.clock.observedAt });
      return { obligationId: row.obligation_id, operationId, revision: row.revision, event: event.kind, occurredAt: row.clock.observedAt };
    },
  };
});

import { escalateCoManagedTicket, handBackCoManagedTicket } from '../ticketHandoffs';
import { registerCoManagedTicketSlaHandlers, resetCoManagedTicketSlaRegistrationForTests } from '../ticketSlaRegistration';
import { resetTicketLifecycleHandlers } from '@alga-psa/tickets/lib/ticketLifecycleHooks';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = id(0xc1), S = id(0xa1), REL = id(0xe1), TICKET = id(0xf1), BOARD = id(0xb1), SCLIENT = id(0xd1);
const CUSER = id(0xc2), SUSER = id(0xa2), SESSION = id(0xaa), PRIORITY = id(0x71), MSP_PRIORITY = id(0x72), STATUS = id(0x73), POLICY = id(0x99);
const customer = { kind: 'session', tenant: C, userId: CUSER, sessionId: SESSION } as const;
const msp = { kind: 'session', tenant: S, userId: SUSER, sessionId: SESSION } as const;
const resource = { tenant: C, relationshipId: REL, kind: 'ticket', id: TICKET } as const;
const T0 = Date.UTC(2026, 9, 27, 9, 0, 0), MIN = 60_000;
const req = (expectedRevision: number, operationId: string) => ({ operationId, expectedRevision, note: 'note' });

let store: FakeStore, db: any;
const obligations = () => store.rows('sla_organization_obligations');
const events = () => store.rows('sla_organization_events');
const at = (minutes: number) => { ctx.now = T0 + minutes * MIN; };

beforeEach(() => {
  ({ store, db } = createFake());
  ctx.store = store;
  db.select = () => ({ first: async () => ({ at: new Date(ctx.now) }) });
  resetTicketLifecycleHandlers(); resetCoManagedTicketSlaRegistrationForTests(); registerCoManagedTicketSlaHandlers();
  store.seed('co_management_relationships', { tenant: C, relationship_id: REL, sponsor_tenant: S, sponsor_client_id: SCLIENT, escalation_board_id: BOARD, revision: 1 });
  store.seed('tickets', { tenant: C, ticket_id: TICKET, priority_id: PRIORITY, status_id: STATUS, response_state: null });
  store.seed('statuses', { tenant: C, status_id: STATUS, is_closed: false });
  store.seed('boards', { tenant: S, board_id: BOARD, is_inactive: false });
  store.seed('clients', { tenant: S, client_id: SCLIENT });
  store.seed('users', { tenant: C, user_id: CUSER, first_name: 'Cara' }, { tenant: S, user_id: SUSER, first_name: 'Max' });
  store.seed('tenants', { tenant: C, client_name: 'Customer Co', product_code: 'co_managed', suspended_at: null },
    { tenant: S, client_name: 'MSP Co', product_code: 'psa', suspended_at: null });
  store.seed('co_managed_sla_priority_mappings', { tenant: S, customer_tenant: C, relationship_id: REL, customer_priority_id: PRIORITY, msp_priority_id: MSP_PRIORITY });
  store.seed('priorities', { tenant: S, priority_id: MSP_PRIORITY, item_type: 'ticket' });
  store.seed('sla_policies', { tenant: S, sla_policy_id: POLICY });
  store.seed('sla_policy_targets', { tenant: S, sla_policy_id: POLICY, priority_id: MSP_PRIORITY, response_time_minutes: 60, resolution_time_minutes: 480 });
  at(0);
});

describe('organization SLA clock follows responsibility through the real handoff path', () => {
  it('starts on escalate, pauses on hand back keeping elapsed time, resumes from it on re-escalate, and never double-starts', async () => {
    const first = id(0x101);
    await escalateCoManagedTicket(db, customer, resource, req(0, first));
    expect(obligations()).toHaveLength(1);
    expect(obligations()[0].clock).toMatchObject({ pauseReasons: [], elapsedMilliseconds: 0, startedAt: new Date(T0).toISOString() });
    expect(obligations()[0].clock.response.dueAt).toBe(new Date(T0 + 60 * MIN).toISOString());

    at(10);
    await handBackCoManagedTicket(db, msp, resource, req(1, id(0x102)));
    expect(obligations()[0].clock.pauseReasons).toEqual(['customer_responsible']);
    expect(obligations()[0].clock.elapsedMilliseconds).toBe(10 * MIN);

    at(30);
    await escalateCoManagedTicket(db, customer, resource, req(2, id(0x103)));
    expect(obligations()).toHaveLength(1);
    expect(obligations()[0].clock.pauseReasons).toEqual([]);
    expect(obligations()[0].clock.elapsedMilliseconds).toBe(10 * MIN); // the 20 minutes with the customer did not count
    // 10 minutes already spent, so the 60 minute response target is 50 minutes from the resume.
    expect(obligations()[0].clock.response.dueAt).toBe(new Date(T0 + 80 * MIN).toISOString());
    expect(events().map(e => e.event_type)).toEqual(['started', 'paused', 'resumed']);

    // A redelivered escalate (same operationId) returns the original receipt and writes no second clock fact.
    await escalateCoManagedTicket(db, customer, resource, req(0, first));
    expect(obligations()).toHaveLength(1);
    expect(events().map(e => e.event_type)).toEqual(['started', 'paused', 'resumed']);
  });

  it('starts nothing when no handler is registered (flag off / no entitlement)', async () => {
    resetTicketLifecycleHandlers();
    await escalateCoManagedTicket(db, customer, resource, req(0, id(0x201)));
    expect(obligations()).toHaveLength(0);
    expect(store.rows('co_management_ticket_work')).toHaveLength(1);
  });
});
