import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { assertCoManagedSeatAdmission } from '@alga-psa/licensing';
import { retryCoManagedInitialAdministratorInvitation } from '../../../../../packages/co-managed/src/provisioningInvitation';
import type { CoManagedProvisioningOperation } from '../../../../../packages/co-managed/src/provisioning';
import { bootstrapCoManagedWorkspace } from '../../../../../ee/temporal-workflows/src/db/co-managed-provisioning-operations';
import { deliverCoManagedAdministratorInvitation } from '../../../../../ee/temporal-workflows/src/activities/co-managed-provisioning-activities';

export function registerCoManagedInvitationRecoveryTests(getDb: () => Knex,
  prepare: () => Promise<CoManagedProvisioningOperation>, send: ReturnType<typeof vi.fn>) {
  async function fixture() {
    const db = getDb(), operation = await prepare(), sponsor = tenantDb(db, operation.tenant);
    await bootstrapCoManagedWorkspace(db, operation.tenant, operation.operation_id, { info() {}, warn() {}, error() {} });
    const customer = tenantDb(db, operation.customer_tenant), roleId = randomUUID(), sessionId = randomUUID();
    await sponsor.table('roles').insert({ tenant: operation.tenant, role_id: roleId, role_name: 'Invitation recovery', msp: true, client: false });
    await sponsor.table('user_roles').insert({ tenant: operation.tenant, user_id: operation.requested_by, role_id: roleId });
    for (const [resource, action] of [['co_management', 'manage'], ['client', 'read']]) {
      const permissionId = randomUUID();
      await sponsor.table('permissions').insert({ tenant: operation.tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await sponsor.table('role_permissions').insert({ tenant: operation.tenant, role_id: roleId, permission_id: permissionId });
    }
    await sponsor.table('sessions').insert({ tenant: operation.tenant, session_id: sessionId, user_id: operation.requested_by, expires_at: new Date(Date.now() + 3600000) });
    const actor = { kind: 'session' as const, tenant: operation.tenant, userId: operation.requested_by, sessionId };
    const input = { sponsorTenant: operation.tenant, operationId: operation.operation_id };
    const invitation = () => customer.table('user_invitations').where('invitation_id', operation.administrator_invitation_id).first();
    const retry = () => retryCoManagedInitialAdministratorInvitation(db, actor, operation.operation_id);
    const deliver = () => deliverCoManagedAdministratorInvitation(input);
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://co-managed.example.test'); send.mockReset().mockResolvedValue(true);
    return { db, operation, sponsor, customer, actor, roleId, input, invitation, retry, deliver };
  }

  describe('initial administrator invitation recovery', () => {
    it('does not renew or deliver an expired initial invitation when active users and pending invitations fill its allocation', async () => {
      const f = await fixture(), original = await f.invitation();
      await f.customer.table('user_invitations').where('invitation_id', original.invitation_id).update({ expires_at: new Date(0) });
      const id = randomUUID();
      await f.customer.table('users').insert({ tenant: f.operation.customer_tenant, user_id: id, username: `allocated-${id}`,
        email: `allocated-${id}@example.test`, first_name: 'Existing', last_name: 'Technician', hashed_password: 'unchanged-password', user_type: 'internal', is_inactive: false });
      await f.customer.table('user_invitations').insert({ tenant: f.operation.customer_tenant, invitation_id: randomUUID(), email: `pending-${id}@example.test`,
        first_name: 'Pending', last_name: 'Technician', role_id: original.role_id, token: randomUUID(), expires_at: new Date(Date.now() + 3600000), metadata: {} });
      const before = await f.invitation(), operation = await f.sponsor.table('co_managed_provisioning_operations').first();
      await expect(f.retry()).rejects.toMatchObject({ code: 'CO_MANAGED_SEAT_LIMIT' });
      await expect(f.deliver()).rejects.toMatchObject({ code: 'CO_MANAGED_SEAT_LIMIT' });
      expect(await f.invitation()).toEqual(before);
      expect(await f.sponsor.table('co_managed_provisioning_operations').first()).toEqual(operation);
      expect(send).not.toHaveBeenCalled();
      expect(await f.sponsor.table('co_managed_allocations')).toEqual([expect.objectContaining({ seats: 2, state: 'reserved' })]);
    });
    it('accepts the replacement token through the real user service exactly once and rejects the old link', async () => {
      const f = await fixture(); await f.deliver(); const old = await f.invitation();
      await f.customer.table('user_invitations').update({ expires_at: new Date(0) });
      await f.retry(); const renewed = await f.invitation();
      const { UserService } = await import('../../../../../packages/users/src/services/UserService');
      const service = new UserService();
      vi.spyOn(service as any, 'ensurePermission').mockResolvedValue(undefined);
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: f.db });
      vi.spyOn(service as any, 'enhanceUsersWithDetails').mockImplementation(async (rows: unknown) => rows);
      const context = { tenant: f.operation.customer_tenant, userId: randomUUID() };
      await expect(runWithTenant(context.tenant, () => service.createFromInvitation(old.token, 'Testing-strong-password-42!', context)))
        .rejects.toThrow('Invalid or expired');
      const created = await runWithTenant(context.tenant, () => Promise.allSettled([
        service.createFromInvitation(renewed.token, 'Testing-strong-password-42!', context),
        service.createFromInvitation(renewed.token, 'Different-password-must-not-reset-42!', context),
      ]));
      expect(created.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const users = await f.customer.table('users'); expect(users).toHaveLength(1);
      expect(await f.customer.table('user_roles')).toEqual([expect.objectContaining({ user_id: users[0].user_id, role_id: renewed.role_id })]);
      expect((await f.invitation()).used_at).not.toBeNull();
      await expect(f.retry()).rejects.toThrow(); await f.deliver();
      expect(await f.customer.table('users')).toEqual(users);
      expect((await f.customer.table('co_management_relationships').first()).state).toBe('pending_acceptance');
    });
    it('renews a successfully delivered expired invitation once and uses the same workspace allocation and workflow identity', async () => {
      const f = await fixture(); await f.deliver();
      const before = await f.invitation(), allocations = await f.sponsor.table('co_managed_allocations'), relationship = await f.customer.table('co_management_relationships').first();
      await f.customer.table('user_invitations').update({ expires_at: new Date(0) });
      await Promise.all([f.retry(), f.retry()]);
      const renewed = await f.invitation();
      expect(renewed.token).not.toBe(before.token); expect(new Date(renewed.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(renewed).toMatchObject({ invitation_id: before.invitation_id, email: before.email, role_id: before.role_id, metadata: before.metadata });
      expect(await f.customer.table('user_invitations').where('token', before.token)).toEqual([]);
      expect(await f.sponsor.table('co_managed_allocations')).toEqual(allocations);
      expect(await f.customer.table('co_management_relationships').first()).toEqual(relationship);
      expect(await f.customer.table('users')).toEqual([]);
      expect((await f.sponsor.table('co_managed_provisioning_operations').first()).invitation_sent_at).toBeNull();
      await f.deliver(); await f.retry(); await f.deliver();
      expect((await f.invitation()).token).toBe(renewed.token);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ tenant: f.operation.customer_tenant, email: before.email,
        inviteLink: `https://co-managed.example.test/auth/team/setup?token=${renewed.token}` }));
      for (const table of ['tenants', 'user_invitations']) expect(await f.customer.table(table)).toHaveLength(1);
      expect(await f.sponsor.table('co_managed_provisioning_operations')).toHaveLength(1);
    });

    it('retains the replacement token through failed delivery and does not require new pool capacity', async () => {
      const f = await fixture(); await f.deliver();
      await f.customer.table('user_invitations').update({ expires_at: new Date(0) });
      await f.sponsor.table('co_managed_entitlements').update({ valid_until: new Date(0) });
      await f.retry(); const renewed = await f.invitation();
      send.mockResolvedValueOnce(false);
      await expect(f.deliver()).rejects.toThrow('could not be delivered');
      await f.retry(); await f.deliver();
      expect((await f.invitation()).token).toBe(renewed.token);
      expect(await f.sponsor.table('co_managed_allocations')).toEqual([expect.objectContaining({ seats: 2, state: 'reserved' })]);
      await expect(f.db.transaction(trx => assertCoManagedSeatAdmission(trx, f.operation.customer_tenant,
        { email: renewed.email, invitationToken: renewed.token }))).rejects.toMatchObject({ code: 'CO_MANAGED_LICENSE_LAPSED' });
    });

    it('rejects foreign sessions, revoked home roles, expired sessions and altered invitation scope without changing the token', async () => {
      const f = await fixture(), original = await f.invitation();
      await f.customer.table('user_invitations').update({ expires_at: new Date(0) });
      await expect(retryCoManagedInitialAdministratorInvitation(f.db, { ...f.actor, tenant: randomUUID() }, f.operation.operation_id)).rejects.toThrow();
      await f.sponsor.table('user_roles').where('role_id', f.roleId).delete();
      await expect(f.retry()).rejects.toThrow();
      await f.sponsor.table('user_roles').insert({ tenant: f.actor.tenant, user_id: f.actor.userId, role_id: f.roleId });
      await f.sponsor.table('sessions').where('session_id', f.actor.sessionId).update({ expires_at: new Date(0) });
      await expect(f.retry()).rejects.toThrow();
      await f.sponsor.table('sessions').where('session_id', f.actor.sessionId).update({ expires_at: new Date(Date.now() + 3600000) });
      await f.customer.table('user_invitations').update({ metadata: { ...original.metadata, sponsor_tenant: randomUUID() } });
      await expect(f.retry()).rejects.toThrow(); await expect(f.deliver()).rejects.toThrow();
      expect((await f.invitation()).token).toBe(original.token); expect(send).not.toHaveBeenCalled();
    });

    it('does not reset a consumed invitation or an existing administrator before acceptance', async () => {
      const f = await fixture(), original = await f.invitation();
      await f.customer.table('user_invitations').update({ expires_at: new Date(0), used_at: new Date() });
      await expect(f.retry()).rejects.toThrow(); await f.deliver(); expect(send).not.toHaveBeenCalled();
      await f.customer.table('user_invitations').update({ used_at: null });
      const id = randomUUID();
      await f.customer.table('users').insert({ tenant: f.operation.customer_tenant, user_id: id, username: `existing-${id}`,
        email: original.email.toUpperCase(), first_name: 'Existing', last_name: 'Admin', hashed_password: 'unchanged-password', user_type: 'internal', is_inactive: false });
      await expect(f.retry()).rejects.toThrow(); await f.deliver();
      expect((await f.invitation()).token).toBe(original.token);
      expect((await f.customer.table('users').first()).hashed_password).toBe('unchanged-password'); expect(send).not.toHaveBeenCalled();
    });

    it('serializes delivery acknowledgment with a concurrent retry so a completed send cannot acknowledge a different token', async () => {
      const f = await fixture();
      await f.customer.table('user_invitations').update({ expires_at: new Date(0) });
      const original = await f.invitation();
      let release!: () => void, entered!: () => void;
      const sending = new Promise<void>(resolve => { entered = resolve; });
      const finish = new Promise<void>(resolve => { release = resolve; });
      send.mockImplementationOnce(async () => { entered(); await finish; return true; });
      const delivered = f.deliver(); await sending;
      const retry = f.retry(); release(); await Promise.all([delivered, retry]);
      expect((await f.invitation()).token).toBe(original.token);
      expect((await f.sponsor.table('co_managed_provisioning_operations').first()).invitation_sent_at).not.toBeNull();
      await f.deliver(); expect(send).toHaveBeenCalledOnce();
    });
  });
}
