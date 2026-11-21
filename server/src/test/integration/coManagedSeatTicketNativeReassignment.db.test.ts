/**
 * Co-managed seat and workspace shapes, slice S23 (F057 / T030) on real Postgres, through the
 * native ticket writers.
 *
 * A handoff names the work revision its actor saw. A native reassignment of the ticket, made on
 * the MSP ticket screen, over the REST API or by a workflow, moves that revision on in the same
 * transaction, so a handoff prepared before it is refused. A save that leaves the assignee alone
 * does not, and a ticket of a client with no seat arrangement is never tracked.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const dbRef = vi.hoisted(() => ({
  knex: null as Knex | null,
  tenant: '',
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const publishWorkflowEventMock = vi.hoisted(() =>
  vi.fn<typeof import('server/src/lib/eventBus/publishers').publishWorkflowEvent>(async () => undefined)
);

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
  getConnection: vi.fn(async () => dbRef.knex),
}));

// BaseService (the TicketService base) imports createTenantKnex from the
// internal tenant module, not the @alga-psa/db barrel, so the barrel mock
// above never intercepts it. Mock the same resolved module to point the
// service at the suite's tenant/db handle while keeping real withTransaction.
vi.mock('@alga-psa/db/tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db/tenant')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  withOptionalAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getTicketAttributes: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: publishWorkflowEventMock,
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

// TicketService uses the server-local publisher. Capture delivery at that
// boundary so the service still exercises its workflow-event behavior.
vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: publishWorkflowEventMock,
  publishEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/event-bus', () => ({
  getEventBus: vi.fn(() => ({ publish: vi.fn() })),
  ServerEventPublisher: class {},
}));

vi.mock('@alga-psa/analytics', () => ({
  captureAnalytics: vi.fn(),
  ServerAnalyticsTracker: class {},
  analytics: { capture: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('../../../../packages/tickets/src/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  publishTicketUpdate: vi.fn(),
}));

import {
  createCoManagedSeatArrangement, handCoManagedSeatTicketToClientIt, readCoManagedSeatTicketWork, setCoManagedSeatBoardScope,
} from '@alga-psa/co-managed';
import { tenantDb } from '@alga-psa/db';
import { updateTicketWithCache } from '../../../../packages/tickets/src/actions/optimizedTicketActions';
import { TicketModel } from '../../../../shared/models/ticketModel';
import { TicketService } from '../../lib/api/services/TicketService';
import { createCloseRulesFixture, insertTicket, type CloseRulesFixture } from './helpers/closeRulesFixture';

const HOOK_TIMEOUT = 240_000;
const DAY = 86_400_000;

let db: Knex;
let fixture: CloseRulesFixture;
let arrangementId: string;
let otherStaff: string;

describe('a native ticket reassignment makes a prepared seat handoff stale', () => {
  const tenant = () => fixture.tenantId;
  const serviceContext = () => ({ tenant: tenant(), userId: fixture.userId, user: userRef.user }) as any;
  const work = (ticketId: string) => readCoManagedSeatTicketWork(db, { sponsorTenant: tenant(), ticketId });
  const workRows = (ticketId: string) => db('co_managed_seat_ticket_work').where({ tenant: tenant(), ticket_id: ticketId });
  const receipts = (ticketId: string) => db('co_managed_seat_ticket_handoffs').where({ tenant: tenant(), ticket_id: ticketId });
  const assignee = async (ticketId: string) =>
    (await db('tickets').where({ tenant: tenant(), ticket_id: ticketId }).first('assigned_to')).assigned_to;
  const toClientIt = (ticketId: string, expectedRevision: number) => handCoManagedSeatTicketToClientIt(db, {
    sponsorTenant: tenant(), ticketId, actorUserId: fixture.userId, operationId: randomUUID(), expectedRevision,
    note: 'Yours from here: the user is on site.' });

  /** The handoff the actor prepared at `staleRevision` is refused and leaves nothing; a fresh one goes through. */
  const expectStaleHandoffRefused = async (ticketId: string, staleRevision: number) => {
    await expect(toClientIt(ticketId, staleRevision)).rejects.toMatchObject({ code: 'HANDOFF_CHANGED' });
    expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'msp', revision: staleRevision + 1 });
    expect(await receipts(ticketId)).toHaveLength(0);
    expect(await toClientIt(ticketId, staleRevision + 1)).toMatchObject({ from: 'msp', to: 'client_it', revision: staleRevision + 2 });
  };

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 's23_seat_ticket_native_reassignment_test' });
    dbRef.knex = db;

    const seededUser = await tenantDb(db, '__test_discovery__')
      .unscoped('users', 'test discovery of seeded internal user for seat handoff native reassignment integration')
      .where({ user_type: 'internal' })
      .first();
    expect(seededUser).toBeTruthy();
    dbRef.tenant = seededUser.tenant;
    userRef.user = {
      user_id: seededUser.user_id,
      tenant: seededUser.tenant,
      user_type: 'internal',
      first_name: seededUser.first_name ?? 'Test',
      last_name: seededUser.last_name ?? 'User',
      username: seededUser.username,
    };
    fixture = await createCloseRulesFixture(db, seededUser.tenant, seededUser.user_id);

    otherStaff = randomUUID();
    await db('users').insert({ tenant: tenant(), user_id: otherStaff, username: `s23-${otherStaff.slice(0, 8)}`,
      first_name: 'Dorothy', last_name: 'Gale', hashed_password: 'not-used', user_type: 'internal',
      email: `s23-${otherStaff.slice(0, 8)}@example.com` });

    await db('co_managed_entitlements').insert({ tenant: tenant(), source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant(), clientId: fixture.clientId,
      operationId: randomUUID(), seats: 3 });
    arrangementId = arrangement.arrangement_id;
    await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant(), arrangementId, boards: [{ boardId: fixture.boardId, canCreate: true }] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  // The reviewed reproduction: reassign on the MSP ticket screen, then submit the handoff prepared at revision 0.
  it('the MSP ticket screen save that changes the assignee', async () => {
    const ticketId = await insertTicket(db, fixture, { assigned_to: fixture.userId });
    expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'msp', revision: 0 });

    expect(await updateTicketWithCache(ticketId, { assigned_to: otherStaff })).toBe('success');
    expect(await assignee(ticketId)).toBe(otherStaff);

    await expectStaleHandoffRefused(ticketId, 0);
  }, HOOK_TIMEOUT);

  it('the REST API update that changes the assignee', async () => {
    const ticketId = await insertTicket(db, fixture, { assigned_to: fixture.userId });

    await new TicketService().update(ticketId, { assigned_to: otherStaff }, serviceContext());
    expect(await assignee(ticketId)).toBe(otherStaff);

    await expectStaleHandoffRefused(ticketId, 0);
  }, HOOK_TIMEOUT);

  it('the shared ticket model update that workflows and inbound writers use', async () => {
    const ticketId = await insertTicket(db, fixture, { assigned_to: fixture.userId });

    await db.transaction((trx) => TicketModel.updateTicket(ticketId, { assigned_to: otherStaff } as any, tenant(), trx));
    expect(await assignee(ticketId)).toBe(otherStaff);

    await expectStaleHandoffRefused(ticketId, 0);
  }, HOOK_TIMEOUT);

  it('a reassignment while client IT is responsible keeps responsibility and moves the revision on', async () => {
    const ticketId = await insertTicket(db, fixture, { assigned_to: fixture.userId });
    await toClientIt(ticketId, 0);

    expect(await updateTicketWithCache(ticketId, { assigned_to: otherStaff })).toBe('success');
    expect(await work(ticketId)).toEqual({ arrangementId, responsibility: 'client_it', revision: 2 });
    expect(await receipts(ticketId)).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('a save that leaves the assignee alone does not move the revision', async () => {
    const ticketId = await insertTicket(db, fixture, { assigned_to: fixture.userId });

    expect(await updateTicketWithCache(ticketId, { title: 'Renamed on the ticket screen' })).toBe('success');
    expect(await updateTicketWithCache(ticketId, { assigned_to: fixture.userId })).toBe('success');
    await new TicketService().update(ticketId, { title: 'Renamed over REST', assigned_to: fixture.userId }, serviceContext());
    await db.transaction((trx) => TicketModel.updateTicket(ticketId, { title: 'Renamed by a workflow' } as any, tenant(), trx));

    expect(await workRows(ticketId)).toHaveLength(0);
    expect(await toClientIt(ticketId, 0)).toMatchObject({ revision: 1 });
  }, HOOK_TIMEOUT);

  it('a reassignment of a ticket whose client has no seat arrangement writes no work row', async () => {
    const clientId = randomUUID();
    await db('clients').insert({ ...(await db('clients').where({ tenant: tenant(), client_id: fixture.clientId }).first()),
      client_id: clientId, client_name: `No arrangement ${clientId.slice(0, 8)}` });
    const before = await db('co_managed_seat_ticket_work').where({ tenant: tenant() }).count('* as n').first();

    for (const reassign of [
      (id: string) => updateTicketWithCache(id, { assigned_to: otherStaff }),
      (id: string) => new TicketService().update(id, { assigned_to: otherStaff }, serviceContext()),
      (id: string) => db.transaction((trx) => TicketModel.updateTicket(id, { assigned_to: otherStaff } as any, tenant(), trx)),
    ]) {
      const ticketId = await insertTicket(db, fixture, { client_id: clientId, contact_name_id: null, assigned_to: fixture.userId });
      await reassign(ticketId);
      expect(await assignee(ticketId)).toBe(otherStaff);
      expect(await work(ticketId)).toBeNull();
    }

    expect(await db('co_managed_seat_ticket_work').where({ tenant: tenant() }).count('* as n').first()).toEqual(before);
  }, HOOK_TIMEOUT);
});
