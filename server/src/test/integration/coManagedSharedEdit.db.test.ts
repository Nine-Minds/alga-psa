/**
 * CM L3b1 deploy-fix round: real-Postgres checks that
 *  - the ticket screen summary carries responsibility / work revision, so the
 *    escalate and hand-back affordances follow the handoff state machine, and
 *  - a shared (MSP-side) ticket edit persists on a fully migrated schema with a
 *    qualified audit row (actor_reference_id set, actor_user_id null).
 *
 * Fixture: one sponsor MSP (psa) with a technician, one customer workspace
 * (co_managed) with a scoped board. Each run uses its own scratch database.
 * The tests run in order and share state.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ db: null as any, actor: null as any, user: null as any }));

vi.mock('@alga-psa/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (fn: any) => (...args: any[]) => fn(holder.user, { tenant: holder.actor.tenant }, ...args),
}));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: async () => ({ knex: holder.db, tenant: holder.actor.tenant }),
}));
vi.mock('@/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => holder.actor }));
vi.mock('../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => holder.actor }));

import {
  escalateCoManagedTicket,
  getCoManagedTicketScreen,
  handBackCoManagedTicket,
  type CoManagedSessionActor,
  type CoManagedSharedResource,
} from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

describeDb('co-managed screen state and shared edit on real Postgres', { shuffle: false }, () => {
  let db: Knex;
  let msp: string;
  let customer: string;
  let relationshipId: string;
  let ticketId: string;
  let openStatus: string;
  let progressStatus: string;
  let admin: CoManagedSessionActor;
  let tech: CoManagedSessionActor;

  async function actorFor(tenant: string, permissions: Array<[string, string]>) {
    const userId = await createUser(db, tenant, { user_type: 'internal' });
    const roleId = randomUUID();
    await db('roles').insert({ tenant, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: true, client: false });
    for (const [resource, action] of permissions) {
      const permissionId = randomUUID();
      await db('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await db('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
    }
    await db('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    const sessionId = randomUUID();
    await db('sessions').insert({ tenant, session_id: sessionId, user_id: userId, expires_at: new Date(Date.now() + 3600_000), created_at: new Date() });
    return { kind: 'session', tenant, userId, sessionId } as CoManagedSessionActor;
  }

  const resource = (): CoManagedSharedResource => ({ tenant: customer, relationshipId, kind: 'ticket', id: ticketId });
  const screen = (actor: CoManagedSessionActor) => getCoManagedTicketScreen(db, actor, resource());
  const handoff = (expectedRevision: number) => ({ operationId: randomUUID(), expectedRevision, note: 'shared IT note' });

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l3b1_shared_edit_test' });
    holder.db = db;
    msp = await createTenant(db, 'Sponsor MSP', { productCode: 'psa' });
    const mspBoard = randomUUID();
    await db('boards').insert({ tenant: msp, board_id: mspBoard, board_name: 'Escalations', is_inactive: false });
    tech = await actorFor(msp, [['ticket', 'read'], ['ticket', 'update']]);

    customer = await createTenant(db, 'Customer', { productCode: 'co_managed' });
    const customerClient = await createClient(db, customer, 'Customer client');
    const sponsorClient = await createClient(db, msp, 'Sponsor client');
    admin = await actorFor(customer, [['ticket', 'read'], ['ticket', 'update'], ['co_management', 'manage']]);
    relationshipId = randomUUID();
    const board = randomUUID();
    await db('boards').insert({ tenant: customer, board_id: board, board_name: 'Scoped' });
    openStatus = randomUUID(); progressStatus = randomUUID();
    await db('statuses').insert([
      { tenant: customer, status_id: openStatus, name: 'Open', status_type: 'ticket', item_type: 'ticket', board_id: board, order_number: 1, is_closed: false },
      { tenant: customer, status_id: progressStatus, name: 'In progress', status_type: 'ticket', item_type: 'ticket', board_id: board, order_number: 2, is_closed: false },
    ]);
    const priority = randomUUID();
    await db('priorities').insert({ tenant: customer, priority_id: priority, priority_name: 'Normal', order_number: 1 });
    await db('co_management_relationships').insert({
      tenant: customer, relationship_id: relationshipId, sponsor_tenant: msp, sponsor_client_id: sponsorClient,
      state: 'active', visibility_mode: 'board_scope', escalation_board_id: mspBoard, accepted_by: admin.userId, accepted_at: new Date(),
    });
    await db('co_management_board_scopes').insert({ tenant: customer, relationship_id: relationshipId, board_id: board, can_collaborate: true });
    await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: customer, relationship_id: relationshipId,
      principal_type: 'user', principal_id: tech.userId, relationship_role: 'technician' });
    ticketId = randomUUID();
    await db('tickets').insert({ tenant: customer, ticket_id: ticketId, ticket_number: '1001', title: 'Printer down', client_id: customerClient,
      board_id: board, status_id: openStatus, priority_id: priority, is_closed: false, entered_by: admin.userId });
  }, 300_000);

  afterAll(async () => {
    delete process.env.FORCE_CAPABILITIES;
    await db?.destroy();
  });

  it('before any escalation the customer can escalate: responsibility customer, work revision 0', async () => {
    const s = await screen(admin);
    expect(s.summary.fields.responsibility).toBe('customer');
    expect(s.summary.fields.work_revision).toBe(0);
    expect(s.summary.fields.explicit_grant_active).toBe(false);
    expect(s.canEscalate).toBe(true);
    expect(s.canHandBack).toBe(false);
  });

  it('after escalation responsibility is msp and the MSP can hand back; the customer can take back', async () => {
    await escalateCoManagedTicket(db, admin, resource(), handoff(0));
    const customerScreen = await screen(admin);
    expect(customerScreen.summary.fields).toMatchObject({ responsibility: 'msp', work_revision: 1, explicit_grant_active: true });
    expect(customerScreen.canEscalate).toBe(false);
    expect(customerScreen.canHandBack).toBe(true);
    const mspScreen = await screen(tech);
    expect(mspScreen.summary.fields.responsibility).toBe('msp');
    expect(mspScreen.canHandBack).toBe(true);
    expect(mspScreen.canEscalate).toBe(false);
  });

  it('a shared MSP edit persists with a qualified audit row on the migrated schema', async () => {
    holder.actor = tech;
    holder.user = { user_id: tech.userId, tenant: msp, user_type: 'internal', roles: [] };
    const { saveSharedTicketEditAction } = await import('@/lib/actions/coManagedTicketEditActions');
    const result = await (saveSharedTicketEditAction as any)(resource(), {
      operationId: randomUUID(), expected: { status_id: openStatus }, patch: { status_id: progressStatus },
    });
    expect(result).toMatchObject({ ok: true });
    const ticket = await db('tickets').where({ tenant: customer, ticket_id: ticketId }).first('status_id');
    expect(ticket.status_id).toBe(progressStatus);
    const audit = await db('ticket_audit_logs').where({ tenant: customer, ticket_id: ticketId }).whereNotNull('actor_reference_id').first();
    expect(audit).toBeTruthy();
    expect(audit.actor_user_id).toBeNull();
    expect(audit.actor_organization_name).toBeTruthy();
    const reference = await db('collaboration_actor_references').where({ tenant: customer, actor_reference_id: audit.actor_reference_id }).first();
    expect(reference).toMatchObject({ actor_tenant: msp, actor_user_id: tech.userId });
  });

  it('after hand-back responsibility returns to the customer', async () => {
    const current = await screen(tech);
    expect(current.summary.fields.work_revision).toBe(1);
    await handBackCoManagedTicket(db, tech, resource(), handoff(1));
    const s = await screen(admin);
    expect(s.summary.fields).toMatchObject({ responsibility: 'customer', work_revision: 2 });
    expect(s.canEscalate).toBe(true);
    expect(s.canHandBack).toBe(false);
  });
});
