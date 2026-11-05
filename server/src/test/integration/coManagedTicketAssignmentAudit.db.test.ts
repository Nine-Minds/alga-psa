/**
 * CM L3b2: a sponsor technician's shared-ticket assignment must file its audit_logs row under the customer tenant
 * on a connection where app.current_tenant was never set (the audit trigger throws on an unset setting), and the
 * transaction-local pin must be restored afterwards. Real Postgres, real co_managed_ticket_assignment writer path.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { assignCoManagedTicket, type CoManagedSessionActor, type CoManagedSharedResource } from '@alga-psa/co-managed';
import { withAuditOwnerTenant } from '../../../../packages/co-managed/src/auditOwnerTenant';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const describeDb = await describeWithDb();

describeDb('co-managed ticket assignment audit on real Postgres', { shuffle: false }, () => {
  let db: Knex;
  let msp: string, customer: string, relationshipId: string, ticketId: string;
  let tech: CoManagedSessionActor, assigneeId: string;

  async function actorFor(tenant: string, permissions: Array<[string, string]>): Promise<CoManagedSessionActor> {
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
    return { kind: 'session', tenant, userId, sessionId };
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'l3b2_assignment_audit_test' });
    msp = await createTenant(db, 'Sponsor MSP', { productCode: 'psa' });
    customer = await createTenant(db, 'Customer', { productCode: 'co_managed' });
    tech = await actorFor(msp, [['ticket', 'read'], ['ticket', 'update']]);
    assigneeId = (await actorFor(msp, [['ticket', 'read'], ['ticket', 'update']])).userId;
    const admin = await actorFor(customer, [['ticket', 'read'], ['ticket', 'update'], ['co_management', 'manage']]);
    const customerClient = await createClient(db, customer, 'Customer client');
    const sponsorClient = await createClient(db, msp, 'Sponsor client');
    const mspBoard = randomUUID(), board = randomUUID(), status = randomUUID(), priority = randomUUID();
    relationshipId = randomUUID(); ticketId = randomUUID();
    await db('boards').insert({ tenant: msp, board_id: mspBoard, board_name: 'Escalations', is_inactive: false });
    await db('boards').insert({ tenant: customer, board_id: board, board_name: 'Shared' });
    await db('statuses').insert({ tenant: customer, status_id: status, name: 'Open', status_type: 'ticket', order_number: 1, is_closed: false });
    await db('priorities').insert({ tenant: customer, priority_id: priority, priority_name: 'Normal', order_number: 1 });
    await db('co_management_relationships').insert({ tenant: customer, relationship_id: relationshipId, sponsor_tenant: msp, sponsor_client_id: sponsorClient,
      state: 'active', visibility_mode: 'board_scope', escalation_board_id: mspBoard, accepted_by: admin.userId, accepted_at: new Date() });
    await db('co_management_board_scopes').insert({ tenant: customer, relationship_id: relationshipId, board_id: board, can_collaborate: true });
    await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: customer, relationship_id: relationshipId,
      principal_type: 'user', principal_id: tech.userId, relationship_role: 'technician' });
    await db('co_management_staff_assignments').insert({ tenant: msp, customer_tenant: customer, relationship_id: relationshipId,
      principal_type: 'user', principal_id: assigneeId, relationship_role: 'technician' });
    await db('tickets').insert({ tenant: customer, ticket_id: ticketId, ticket_number: '2001', title: 'Shared ticket', client_id: customerClient, board_id: board,
      status_id: status, priority_id: priority, is_closed: false, entered_by: admin.userId, entered_at: new Date(), updated_at: new Date() });
  }, 300_000);

  afterAll(async () => { await db?.destroy(); });

  const resource = (): CoManagedSharedResource => ({ tenant: customer, relationshipId, kind: 'ticket', id: ticketId });

  it('assigns through the real writer on a connection that never set app.current_tenant, auditing under the customer tenant', async () => {
    // The pool is untouched by earlier code in this suite: prove the setting is genuinely unset on a fresh connection.
    const probe = await db.transaction(async trx => (await trx.raw("select current_setting('app.current_tenant', true) as v")).rows[0].v);
    expect(probe === null || probe === '').toBe(true);

    const operationId = randomUUID();
    await assignCoManagedTicket(db, tech, resource(), { operationId, expectedRevision: 0, assignee: { tenant: msp, kind: 'user', id: assigneeId } });

    const reference = await db('co_managed_ticket_references').where({ tenant: msp, customer_tenant: customer, ticket_id: ticketId }).first();
    expect(reference.assigned_to).toBe(assigneeId);
    // The assignment lives on the sponsor's co_managed_ticket_references row (the customer ticket row is not mutated by design).
    const audit = await db('audit_logs').where({ record_id: ticketId, operation: 'co_managed_ticket_assignment' }).first();
    expect(audit).toBeTruthy();
    expect(audit.tenant).toBe(customer);
    expect(audit.table_name).toBe('tickets');
    expect(audit.details.operation_id).toBe(operationId);
  });

  it('restores app.current_tenant after the call (prior value and unset)', async () => {
    await db.transaction(async trx => {
      const read = async () => (await trx.raw("select current_setting('app.current_tenant', true) as v")).rows[0].v;
      await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', msp]);
      await withAuditOwnerTenant(trx, customer, async () => { expect(await read()).toBe(customer); });
      expect(await read()).toBe(msp);
      await expect(withAuditOwnerTenant(trx, customer, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
      expect(await read()).toBe(msp);
    });
    await db.transaction(async trx => {
      const read = async () => (await trx.raw("select current_setting('app.current_tenant', true) as v")).rows[0].v;
      await withAuditOwnerTenant(trx, customer, async () => { expect(await read()).toBe(customer); });
      const after = await read();
      expect(after === null || after === '').toBe(true);
    });
  });
});
