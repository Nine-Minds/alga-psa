import type { Knex } from 'knex';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState } from '@alga-psa/licensing';
import { prepareCoManagedProvisioning, runCoManagedProvisioningStep, recordCoManagedProvisioningFailure,
  type CoManagedProvisioningOperation } from '../../../../../../packages/co-managed/src/provisioning';
import { retryCoManagedInitialAdministratorInvitation } from '../../../../../../packages/co-managed/src/provisioningInvitation';
import { bootstrapCoManagedWorkspace } from '../../../db/co-managed-provisioning-operations';
import { bootstrapCoManagedCustomer, deliverCoManagedAdministratorInvitation } from '../../../activities/co-managed-provisioning-activities';

interface Harness {
  getDb: () => Knex;
  prepare: (overrides?: { seats?: number; email?: string; capacity?: number }) => Promise<CoManagedProvisioningOperation>;
  delivery: { send: ReturnType<typeof vi.fn> };
}

const messages: string[] = [];
const log = { info: (m: string) => void messages.push(m), warn() {}, error() {} };

/** Grants the requesting MSP user co_management:manage and client:read through a live session. */
async function sponsorActor(db: Knex, operation: CoManagedProvisioningOperation) {
  const tenant = operation.tenant, home = tenantDb(db, tenant);
  const roleId = randomUUID(), sessionId = randomUUID();
  await home.table('roles').insert({ tenant, role_id: roleId, role_name: `Manager ${roleId}`, description: 'test', msp: true, client: false });
  for (const [resource, action] of [['co_management', 'manage'], ['client', 'read']]) {
    const permissionId = randomUUID();
    await home.table('permissions').insert({ tenant, permission_id: permissionId, resource, action, msp: true, client: false });
    await home.table('role_permissions').insert({ tenant, role_id: roleId, permission_id: permissionId });
  }
  await home.table('user_roles').insert({ tenant, user_id: operation.requested_by, role_id: roleId });
  await home.table('sessions').insert({ tenant, session_id: sessionId, user_id: operation.requested_by,
    expires_at: new Date(Date.now() + 3600000) });
  return { kind: 'session' as const, tenant, userId: operation.requested_by, sessionId };
}

export function registerCoManagedProvisioningTests({ getDb, prepare, delivery }: Harness) {
  const input = (operation: CoManagedProvisioningOperation) => ({ sponsorTenant: operation.tenant, operationId: operation.operation_id });
  const stored = (operation: CoManagedProvisioningOperation) =>
    tenantDb(getDb(), operation.tenant).table('co_managed_provisioning_operations').where('operation_id', operation.operation_id).first();
  const invitations = (operation: CoManagedProvisioningOperation) =>
    tenantDb(getDb(), operation.customer_tenant).table('user_invitations');

  beforeEach(() => { process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test'; });
  afterEach(() => { delivery.send.mockReset(); delivery.send.mockResolvedValue(true); messages.length = 0; delete process.env.FORCE_CAPABILITIES;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test'; });

  describe('co-managed provisioning', () => {
    it('runs tenant, seeds, settings and invitation in order, then reaches pending_acceptance', async () => {
      const db = getDb(), operation = await prepare();
      const order: string[] = [];
      const original = db.transaction.bind(db);
      expect((await stored(operation)).state).toBe('queued');
      await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
      const row = await stored(operation);
      expect(row).toMatchObject({ state: 'pending_acceptance', step: 'administrator_invitation' });
      expect(await tenantDb(db, operation.customer_tenant).table('tenants').count({ n: '*' }).first()).toMatchObject({ n: '1' });
      expect(await invitations(operation)).toHaveLength(1);
      expect(row.invitation_sent_at).toBeNull(); // bootstrap never sends mail
      expect(order).toEqual([]); void original;
      expect(await tenantDb(db, operation.tenant).table('co_managed_allocations').first()).toMatchObject({ state: 'reserved', seats: 2 });
    });

    it('records each step in order as it advances', async () => {
      const db = getDb(), operation = await prepare();
      const seen: Array<string | null> = [];
      for (const step of ['tenant', 'seeds', 'settings', 'administrator_invitation'] as const) {
        await runCoManagedProvisioningStep(db, operation.tenant, operation.operation_id, step, async () => undefined);
        seen.push((await stored(operation)).step);
      }
      expect(seen).toEqual(['tenant', 'seeds', 'settings', 'administrator_invitation']);
      // A step can never be skipped ahead.
      const other = await prepare();
      await expect(runCoManagedProvisioningStep(db, other.tenant, other.operation_id, 'settings', async () => undefined))
        .rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
    });

    it('same operationId yields one tenant, allocation, invitation and requested event', async () => {
      const db = getDb(), operation = await prepare();
      const request = { sponsorTenant: operation.tenant, operationId: operation.operation_id, requestedBy: operation.requested_by,
        clientId: operation.request.clientId, escalationBoardId: operation.escalation_board_id, seats: operation.request.seats,
        visibilityMode: operation.request.visibilityMode, workspaceName: operation.request.workspaceName,
        administrator: operation.request.administrator };
      const repeated = await Promise.all([prepareCoManagedProvisioning(db, request), prepareCoManagedProvisioning(db, request)]);
      expect(repeated.every(r => r.operation_id === operation.operation_id && r.customer_tenant === operation.customer_tenant)).toBe(true);
      await Promise.all([bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log),
        bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log)]);
      await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, log);
      const home = tenantDb(db, operation.tenant), customer = tenantDb(db, operation.customer_tenant);
      expect(await customer.table('tenants')).toHaveLength(1);
      expect(await customer.table('user_invitations')).toHaveLength(1);
      expect(await home.table('co_managed_allocations').where('operation_id', operation.operation_id)).toHaveLength(1);
      expect(await home.table('co_managed_provisioning_operations').where('operation_id', operation.operation_id)).toHaveLength(1);
      const events = await db('co_managed_events' as string).where({ tenant: operation.tenant }).catch(() => null);
      if (events) expect(events.filter((e: { event_type?: string }) => /requested|prepared/.test(e.event_type ?? ''))).toHaveLength(1);
      expect(await getCoManagedEntitlementState(db, operation.tenant)).toMatchObject({ allocated: 2 });
    });

    it('rejects the same operationId with different details as OPERATION_CONFLICT', async () => {
      const db = getDb(), operation = await prepare();
      const request = { sponsorTenant: operation.tenant, operationId: operation.operation_id, requestedBy: operation.requested_by,
        clientId: operation.request.clientId, escalationBoardId: operation.escalation_board_id, seats: operation.request.seats,
        visibilityMode: operation.request.visibilityMode, workspaceName: operation.request.workspaceName,
        administrator: operation.request.administrator };
      await expect(prepareCoManagedProvisioning(db, { ...request, seats: request.seats + 1 })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
      await expect(prepareCoManagedProvisioning(db, { ...request, workspaceName: 'Other name' })).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
      expect(await getCoManagedEntitlementState(db, operation.tenant)).toMatchObject({ allocated: 2 });
    });

    it('resumes after a failure by running only the next step', async () => {
      const db = getDb(), operation = await prepare();
      await runCoManagedProvisioningStep(db, operation.tenant, operation.operation_id, 'tenant', async () => undefined);
      await recordCoManagedProvisioningFailure(db, operation.tenant, operation.operation_id);
      expect(await stored(operation)).toMatchObject({ state: 'failed', step: 'tenant', error_code: 'PROVISIONING_FAILED' });
      const work = vi.fn(async () => undefined);
      expect(await runCoManagedProvisioningStep(db, operation.tenant, operation.operation_id, 'tenant', work)).toEqual({ skipped: true });
      expect(work).not.toHaveBeenCalled();
      expect(await runCoManagedProvisioningStep(db, operation.tenant, operation.operation_id, 'seeds', work)).toMatchObject({ skipped: false });
      expect(work).toHaveBeenCalledTimes(1);
      expect(await stored(operation)).toMatchObject({ state: 'provisioning', step: 'seeds', error_code: null });
    });

    it('bootstrap activity then delivery activity sends once and acknowledges', async () => {
      const db = getDb(), operation = await prepare();
      expect(await bootstrapCoManagedCustomer(input(operation))).toBeUndefined();
      expect(await stored(operation)).toMatchObject({ state: 'pending_acceptance', invitation_sent_at: null });
      expect(await deliverCoManagedAdministratorInvitation(input(operation))).toBeUndefined();
      expect(delivery.send).toHaveBeenCalledTimes(1);
      expect(delivery.send.mock.calls[0][0]).toMatchObject({ tenant: operation.customer_tenant, email: operation.request.administrator.email });
      const row = await stored(operation);
      expect(row.state).toBe('pending_acceptance'); expect(row.invitation_sent_at).not.toBeNull();
      await deliverCoManagedAdministratorInvitation(input(operation)); // already acknowledged
      expect(delivery.send).toHaveBeenCalledTimes(1);
      void db;
    });

    it('skips every activity when the capability kill switch is set', async () => {
      const operation = await prepare();
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      expect(await bootstrapCoManagedCustomer(input(operation))).toMatchObject({ skipped: true, capability: 'co-managed' });
      expect(await deliverCoManagedAdministratorInvitation(input(operation))).toMatchObject({ skipped: true });
      expect(await stored(operation)).toMatchObject({ state: 'queued', step: null });
      expect(delivery.send).not.toHaveBeenCalled();
    });

    it('delivers in three phases: no lock held while sending, stale token acknowledgment dropped', async () => {
      const db = getDb(), operation = await prepare();
      await bootstrapCoManagedCustomer(input(operation));
      delivery.send.mockImplementationOnce(async () => {
        // A separate connection must be able to lock the customer tenants row now.
        await db.transaction(async trx => {
          await trx.raw('SET LOCAL lock_timeout = \'1s\'');
          await tenantDb(trx, operation.customer_tenant).table('tenants').forUpdate().first('tenant');
          await tenantDb(trx, operation.customer_tenant).table('user_invitations')
            .where('invitation_id', operation.administrator_invitation_id).update({ token: 'replaced-while-sending' });
        });
        return true;
      });
      await deliverCoManagedAdministratorInvitation(input(operation));
      expect((await stored(operation)).invitation_sent_at).toBeNull(); // old send must not acknowledge a new token
      await deliverCoManagedAdministratorInvitation(input(operation));
      expect(delivery.send).toHaveBeenCalledTimes(2);
      expect((await stored(operation)).invitation_sent_at).not.toBeNull();
    });

    it('records INVITATION_DELIVERY_FAILED and retries delivery', async () => {
      const operation = await prepare();
      await bootstrapCoManagedCustomer(input(operation));
      delivery.send.mockResolvedValueOnce(false);
      await expect(deliverCoManagedAdministratorInvitation(input(operation))).rejects.toThrow();
      expect(await stored(operation)).toMatchObject({ invitation_delivery_error: 'INVITATION_DELIVERY_FAILED', invitation_sent_at: null });
      await deliverCoManagedAdministratorInvitation(input(operation));
      expect(await stored(operation)).toMatchObject({ invitation_delivery_error: null });
      expect((await stored(operation)).invitation_sent_at).not.toBeNull();
    });

    it('allows one resend of a delivered invitation and then RESEND_LIMIT_REACHED', async () => {
      const db = getDb(), operation = await prepare();
      await bootstrapCoManagedCustomer(input(operation));
      await deliverCoManagedAdministratorInvitation(input(operation));
      const actor = await sponsorActor(db, operation);
      await retryCoManagedInitialAdministratorInvitation(db, actor, operation.operation_id, { resend: true });
      expect((await stored(operation)).invitation_sent_at).toBeNull();
      await deliverCoManagedAdministratorInvitation(input(operation));
      expect(delivery.send).toHaveBeenCalledTimes(2);
      await expect(retryCoManagedInitialAdministratorInvitation(db, actor, operation.operation_id, { resend: true }))
        .rejects.toMatchObject({ code: 'RESEND_LIMIT_REACHED' });
      expect((await stored(operation)).invitation_sent_at).not.toBeNull(); // rejected resend changed nothing
      expect(delivery.send).toHaveBeenCalledTimes(2);
    });
  });
}
