/**
 * Isolated Postgres regression for the shared ticket handoff-history action.
 * The action adapter, capability gate, browser-session binding, ticket
 * admission wrappers, reader, and shared actor projection run normally. Only
 * the HTTP auth wrapper and tenant-connection selector are adapted to supply
 * this suite's disposable database and authenticated test session.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localAuthorReference } from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const harness = vi.hoisted(() => ({
  db: null as any,
  actor: null as any,
  user: null as any,
}));

vi.mock('@alga-psa/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(harness.user, { tenant: harness.actor.tenant }, ...args),
  getSession: async () => ({
    session_id: harness.actor.sessionId,
    user: { tenant: harness.actor.tenant, id: harness.actor.userId, user_type: 'internal' },
  }),
  getApiKeyUserOverride: () => null,
}));

vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: harness.db, tenant: harness.actor.tenant }),
}));

import { getSharedTicketHandoffHistoryAction } from '@/lib/actions/coManagedSharedWorkActions';

const describeDb = await describeWithDb();

describeDb('co-managed ticket handoff history action on real Postgres', { shuffle: false }, () => {
  let db: Knex;
  let sponsorTenant: string;
  let customerTenant: string;
  let relationshipId: string;
  let ticketId: string;
  let customerActor: { kind: 'session'; tenant: string; userId: string; sessionId: string };
  let sponsorActor: { kind: 'session'; tenant: string; userId: string; sessionId: string };
  let unassignedSponsorActor: { kind: 'session'; tenant: string; userId: string; sessionId: string };
  let previousCapabilityOverride: string | undefined;
  const resource = () => ({ tenant: customerTenant, relationshipId, kind: 'ticket' as const, id: ticketId });
  const readAs = async (actor: typeof customerActor) => {
    harness.actor = actor;
    harness.user = { user_id: actor.userId, tenant: actor.tenant, user_type: 'internal' };
    return getSharedTicketHandoffHistoryAction(resource());
  };

  async function actorFor(tenant: string, permissions: Array<[string, string]>) {
    const userId = await createUser(db, tenant, { user_type: 'internal', first_name: tenant === sponsorTenant ? 'Morgan' : 'Casey', last_name: 'Actor' });
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permissionId = randomUUID();
      await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    const sessionId = randomUUID();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3_600_000), created_at: new Date() });
    return { kind: 'session' as const, tenant, userId, sessionId };
  }

  beforeAll(async () => {
    previousCapabilityOverride = process.env.FORCE_CAPABILITIES;
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'co_managed_handoff_history_test' });
    harness.db = db;
    sponsorTenant = await createTenant(db, 'Handoff history sponsor', { productCode: 'psa' });
    const sponsorClient = await createClient(db, sponsorTenant, 'Handoff history customer');
    const sponsorBoard = randomUUID();
    await db('boards').insert({ tenant: sponsorTenant, board_id: sponsorBoard, board_name: 'Escalations', is_inactive: false });
    sponsorActor = await actorFor(sponsorTenant, [['ticket', 'read'], ['ticket', 'update']]);
    unassignedSponsorActor = await actorFor(sponsorTenant, [['ticket', 'read'], ['ticket', 'update']]);

    customerTenant = await createTenant(db, 'Handoff history customer', { productCode: 'co_managed' });
    const customerClient = await createClient(db, customerTenant, 'Customer client');
    const customerBoard = randomUUID();
    await db('boards').insert({ tenant: customerTenant, board_id: customerBoard, board_name: 'Customer board' });
    customerActor = await actorFor(customerTenant, [['ticket', 'read'], ['ticket', 'update'], ['co_management', 'manage']]);
    relationshipId = randomUUID();
    await db('co_management_relationships').insert({
      tenant: customerTenant, relationship_id: relationshipId, sponsor_tenant: sponsorTenant, sponsor_client_id: sponsorClient,
      state: 'active', visibility_mode: 'board_scope', escalation_board_id: sponsorBoard,
      accepted_by: customerActor.userId, accepted_at: new Date(),
    });
    await db('co_management_board_scopes').insert({ tenant: customerTenant, relationship_id: relationshipId, board_id: customerBoard, can_collaborate: true });
    await db('co_management_staff_assignments').insert({ tenant: sponsorTenant, customer_tenant: customerTenant, relationship_id: relationshipId,
      principal_type: 'user', principal_id: sponsorActor.userId, relationship_role: 'technician' });
    const statusId = randomUUID(), priorityId = randomUUID();
    await db('statuses').insert({ tenant: customerTenant, status_id: statusId, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
    await db('priorities').insert({ tenant: customerTenant, priority_id: priorityId, priority_name: 'Normal', order_number: 1 });
    ticketId = randomUUID();
    await db('tickets').insert({ tenant: customerTenant, ticket_id: ticketId, ticket_number: '101', title: 'Handoff history ticket',
      client_id: customerClient, board_id: customerBoard, status_id: statusId, priority_id: priorityId,
      is_closed: false, entered_by: customerActor.userId, entered_at: new Date(), updated_at: new Date() });
  }, 300_000);

  afterAll(async () => {
    if (previousCapabilityOverride === undefined) delete process.env.FORCE_CAPABILITIES;
    else process.env.FORCE_CAPABILITIES = previousCapabilityOverride;
    harness.db = null;
    await db?.destroy();
  });

  it('preserves same-tenant IDs and returns stable opaque foreign references in both tenant directions', async () => {
    const escalationOperation = randomUUID();
    harness.actor = customerActor;
    harness.user = { user_id: customerActor.userId, tenant: customerTenant, user_type: 'internal' };
    const { escalateCoManagedTicket, handBackCoManagedTicket } = await import('@alga-psa/co-managed');
    await escalateCoManagedTicket(db, customerActor, resource(), { operationId: escalationOperation, expectedRevision: 0, note: 'shared customer note' });
    await handBackCoManagedTicket(db, sponsorActor, resource(), { operationId: randomUUID(), expectedRevision: 1, note: 'shared sponsor note' });

    // Simulate an older journal row written before UUID display fallbacks were suppressed.
    const legacyOperationId = randomUUID();
    await db('co_management_ticket_handoffs').insert({ tenant: customerTenant, relationship_id: relationshipId, ticket_id: ticketId,
      operation_id: legacyOperationId, revision: 3, transition: 'handed_back', request_fingerprint: '0'.repeat(64),
      actor_tenant: sponsorTenant, actor_user_id: sponsorActor.userId, actor_name: sponsorActor.userId,
      actor_organization: 'Handoff history sponsor', note: 'legacy shared note', audience: 'shared_it', occurred_at: new Date() });

    const customerView = await readAs(customerActor);
    const sponsorView = await readAs(sponsorActor);
    const customerItems = customerView.items;
    const sponsorItems = sponsorView.items;
    const customerForeign = customerItems.find(item => item.operationId === legacyOperationId)?.author as any;
    const sponsorForeign = sponsorItems.find(item => item.operationId === escalationOperation)?.author as any;
    const customerOwn = customerItems.find(item => item.operationId === escalationOperation)?.author as any;
    const sponsorOwn = sponsorItems.find(item => item.transition === 'handed_back' && item.operationId !== legacyOperationId)?.author as any;

    expect(customerOwn).toMatchObject({ tenant: customerTenant, userId: customerActor.userId, name: 'Casey Actor' });
    expect(sponsorOwn).toMatchObject({ tenant: sponsorTenant, userId: sponsorActor.userId, name: 'Morgan Actor' });
    expect(customerForeign).toEqual({ tenant: sponsorTenant, referenceId: localAuthorReference(customerTenant, 'user', sponsorActor.userId),
      side: 'sponsor', name: '', organization: 'Handoff history sponsor' });
    expect(sponsorForeign).toEqual({ tenant: customerTenant, referenceId: localAuthorReference(customerTenant, 'user', customerActor.userId),
      side: 'customer', name: 'Casey Actor', organization: 'Handoff history customer' });
    expect((await readAs(customerActor)).items.find(item => item.operationId === legacyOperationId)?.author).toEqual(customerForeign);
    expect(JSON.stringify(customerView)).not.toContain(sponsorActor.userId);
    expect(JSON.stringify(sponsorView)).not.toContain(customerActor.userId);
  });

  it('omits redacted actors and denies an unassigned sponsor viewer at the resource admission boundary', async () => {
    await db('co_management_relationships').where({ tenant: customerTenant, relationship_id: relationshipId }).update({ redacted_fields: ['actor'] });
    try {
      const redacted = await readAs(sponsorActor);
      expect(redacted.items.length).toBeGreaterThan(0);
      expect(redacted.items.every(item => !('author' in item))).toBe(true);
      expect(JSON.stringify(redacted)).not.toContain(customerActor.userId);
    } finally {
      await db('co_management_relationships').where({ tenant: customerTenant, relationship_id: relationshipId }).update({ redacted_fields: [] });
    }

    await expect(readAs(unassignedSponsorActor)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  });
});
