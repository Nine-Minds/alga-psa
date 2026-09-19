import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import * as bundles from '@alga-psa/authorization';
import { canManageCoManagedClient, getCoManagedManagementOptions, getCoManagedManagementStatus,
  prepareCoManagedProvisioningForActor, changeCoManagedAllocationForActor, withCoManagedManagementOperation,
  getCoManagedClientManagement, resolveCoManagedManagementTarget, getCoManagedOperationTarget,
  getCoManagedClientOverview } from '../../../../../../packages/co-managed/src/managementPolicy';
import { prepareCoManagedProvisioning, type CoManagedProvisioningOperation } from '../../../../../../packages/co-managed/src/provisioning';
import { bootstrapCoManagedWorkspace } from '../../../db/co-managed-provisioning-operations';

export function registerCoManagedManagementPolicyTests(getDb: () => Knex, prepare: () => Promise<CoManagedProvisioningOperation>) {
  async function fixture() {
    const db = getDb(), operation = await prepare(), home = tenantDb(db, operation.tenant), roleId = randomUUID(), sessionId = randomUUID();
    await home.table('roles').insert({ tenant: operation.tenant, role_id: roleId, role_name: 'Scoped provisioning', msp: true, client: false });
    await home.table('user_roles').insert({ tenant: operation.tenant, user_id: operation.requested_by, role_id: roleId });
    for (const [resource, action] of [['co_management', 'read'], ['co_management', 'manage'], ['client', 'read'], ['ticket', 'read']]) {
      const permissionId = randomUUID();
      await home.table('permissions').insert({ tenant: operation.tenant, permission_id: permissionId, resource, action, msp: true, client: false });
      await home.table('role_permissions').insert({ tenant: operation.tenant, role_id: roleId, permission_id: permissionId });
    }
    await home.table('sessions').insert({ tenant: operation.tenant, session_id: sessionId, user_id: operation.requested_by, expires_at: new Date(Date.now() + 3600000) });
    const actor = { kind: 'session' as const, tenant: operation.tenant, userId: operation.requested_by, sessionId };
    const otherClient = randomUUID(), otherBoard = randomUUID();
    await home.table('clients').insert({ tenant: actor.tenant, client_id: otherClient, client_name: 'Hidden customer' });
    await home.table('boards').insert({ tenant: actor.tenant, board_id: otherBoard, board_name: 'Hidden board', is_inactive: false });
    async function policy(resourceType: string, action: string, templateKey: string, config: Record<string, unknown>) {
      const bundle = await bundles.createAuthorizationBundle(db, { tenant: actor.tenant, name: `Management ${randomUUID()}`, actorUserId: actor.userId });
      await bundles.upsertBundleRule(db, { tenant: actor.tenant, ...bundle, resourceType, action, templateKey, config });
      await bundles.publishBundleRevision(db, { tenant: actor.tenant, ...bundle, actorUserId: actor.userId });
      await bundles.createBundleAssignment(db, { tenant: actor.tenant, bundleId: bundle.bundleId, targetType: 'user', targetId: actor.userId });
      return bundle;
    }
    const clientPolicy = await policy('client', 'read', 'selected_clients', { selectedClientIds: [operation.request.clientId] });
    const boardPolicy = await policy('ticket', 'read', 'selected_boards', { selectedBoardIds: [operation.escalation_board_id] });
    const request = { ...operation.request, operationId: randomUUID(), seats: 1 };
    return { db, operation, home, actor, roleId, otherClient, otherBoard, policy, clientPolicy, boardPolicy, request };
  }
  describe('co-managed management policy', () => {
    it('intersects client and board policy before setup labels, search and selected-client fallback', async () => {
      const f = await fixture();
      expect(await getCoManagedManagementOptions(f.db, f.actor, '', f.operation.request.clientId)).toEqual({
        clients: [{ id: f.operation.request.clientId, name: 'Customer' }], boards: [{ id: f.operation.escalation_board_id, name: 'Escalations' }],
      });
      expect(await getCoManagedManagementOptions(f.db, f.actor, 'Hidden', f.otherClient)).toEqual({ clients: [], boards: [] });
      expect((await getCoManagedManagementOptions(f.db, f.actor)).boards).toEqual([]);
      expect(await canManageCoManagedClient(f.db, f.actor, f.otherClient)).toBe(false);
      expect(await canManageCoManagedClient(f.db, f.actor, f.operation.request.clientId)).toBe(true);
      const foreign = await prepare();
      expect(await getCoManagedManagementOptions(f.db, f.actor, 'Hidden', foreign.request.clientId)).toEqual({ clients: [], boards: [] });
      await f.home.table('authorization_bundle_rules').where('revision_id', f.boardPolicy.revisionId).update({ config: { selectedBoardIds: [foreign.escalation_board_id] } });
      expect(await getCoManagedManagementOptions(f.db, f.actor, '', f.operation.request.clientId)).toEqual({ clients: [], boards: [] });
    });

    it('filters status before pagination and foreign lifecycle reads, retaining only authorized operation identities', async () => {
      const f = await fixture();
      const base = await f.home.table('co_managed_provisioning_operations').first();
      // UUID request spelling is not authority: bind canonical home IDs even when a valid request used uppercase.
      await f.home.table('co_managed_provisioning_operations').where('operation_id', f.operation.operation_id)
        .update({ request: { ...base.request, clientId: base.request.clientId.toUpperCase() } });
      const denied = Array.from({ length: 28 }, (_, index) => ({ ...base, operation_id: randomUUID(), customer_tenant: randomUUID(),
        allocation_id: randomUUID(), relationship_id: randomUUID(), created_at: new Date(Date.now() + index * 1000),
        request: { ...base.request, clientId: f.otherClient, workspaceName: 'Hidden workspace', administrator: { ...base.request.administrator, email: 'hidden@example.test' } } }));
      await f.home.table('co_managed_provisioning_operations').insert(denied);
      const page = await getCoManagedManagementStatus(f.db, f.actor);
      expect(page).toMatchObject({ hasMore: false, canManage: true, canCreate: true, items: [{ operationId: f.operation.operation_id, workspaceName: 'Customer IT', canRetry: true }] });
      expect(page.items).toHaveLength(1); expect(JSON.stringify(page)).not.toContain('Hidden'); expect(JSON.stringify(page)).not.toContain('hidden@example.test');
      expect(await getCoManagedManagementStatus(f.db, f.actor, 1)).toMatchObject({ items: [], hasMore: false });
      await expect(getCoManagedManagementStatus(f.db, f.actor, -1)).rejects.toThrow();
      await f.home.table('authorization_bundle_rules').where('revision_id', f.boardPolicy.revisionId).update({ config: { selectedBoardIds: [f.otherBoard] } });
      expect(await getCoManagedManagementStatus(f.db, f.actor)).toMatchObject({ items: [], hasMore: false });
    });

    it('denies starts, retries and allocation changes outside current home policy before reserving or invoking a command', async () => {
      const f = await fixture();
      await f.home.table('co_managed_entitlements').update({ capacity: 10 });
      const before = await f.home.table('co_managed_allocations');
      for (const request of [{ ...f.request, clientId: f.otherClient }, { ...f.request, escalationBoardId: f.otherBoard }])
        await expect(prepareCoManagedProvisioningForActor(f.db, f.actor, request)).rejects.toMatchObject({ code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
      expect(await f.home.table('co_managed_allocations')).toEqual(before);
      const created = await prepareCoManagedProvisioningForActor(f.db, f.actor,
        { ...f.request, sponsorTenant: randomUUID(), requestedBy: randomUUID() } as any);
      expect(created).toMatchObject({ tenant: f.actor.tenant, requested_by: f.actor.userId, request: { clientId: f.operation.request.clientId } });
      expect(await prepareCoManagedProvisioningForActor(f.db, f.actor, f.request)).toMatchObject({ operation_id: created.operation_id });
      const callback = vi.fn(async () => true);
      expect(await withCoManagedManagementOperation(f.db, f.actor, f.operation.operation_id, callback)).toBe(true);
      callback.mockClear();
      await f.home.table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId).update({ config: { selectedClientIds: [f.otherClient] } });
      await expect(withCoManagedManagementOperation(f.db, f.actor, f.operation.operation_id, callback)).rejects.toThrow();
      await expect(changeCoManagedAllocationForActor(f.db, f.actor, { operationId: f.operation.operation_id, seats: 1, expectedSeats: 2 })).rejects.toThrow();
      expect(callback).not.toHaveBeenCalled();
      expect((await f.home.table('co_managed_allocations').where('operation_id', f.operation.operation_id).first()).seats).toBe(2);
    });

    it('retains home policy through authorized resize and distinguishes read access from per-operation management', async () => {
      const f = await fixture();
      await bootstrapCoManagedWorkspace(f.db, f.actor.tenant, f.operation.operation_id, { info() {}, warn() {}, error() {} });
      await changeCoManagedAllocationForActor(f.db, f.actor, { operationId: f.operation.operation_id, seats: 1, expectedSeats: 2 });
      expect((await getCoManagedManagementStatus(f.db, f.actor)).items[0]).toMatchObject({ seats: 1, canChangeSeats: true, canManage: true });
      await f.policy('co_management', 'manage', 'selected_clients', { selectedClientIds: [f.otherClient] });
      expect((await getCoManagedManagementStatus(f.db, f.actor)).items[0]).toMatchObject({ canChangeSeats: false, canManage: false, canRetry: false });
      await expect(changeCoManagedAllocationForActor(f.db, f.actor, { operationId: f.operation.operation_id, seats: 2, expectedSeats: 1 })).rejects.toThrow();
    });

    it('hides restricted labels and identities, treats search wildcards literally and fails closed on unsupported constraints', async () => {
      const f = await fixture();
      expect((await getCoManagedManagementOptions(f.db, f.actor, '%')).clients).toEqual([]);
      await f.home.table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId).update({ config: {
        selectedClientIds: [f.operation.request.clientId], redactedFields: ['client_name', 'administrator.email'],
      } });
      expect(await getCoManagedManagementOptions(f.db, f.actor, '', f.operation.request.clientId)).toEqual({ clients: [], boards: [] });
      expect((await getCoManagedManagementStatus(f.db, f.actor)).items[0]).toMatchObject({ workspaceName: null, administratorEmail: null });
      await f.home.table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId).update({ config: {
        selectedClientIds: [f.operation.request.clientId], redactedFields: ['client_id'],
      } });
      expect(await getCoManagedManagementStatus(f.db, f.actor)).toMatchObject({ items: [], hasMore: false });
      await f.home.table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId).update({ config: {
        selectedClientIds: [f.operation.request.clientId], constraints: [{ field: 'unsupported_field', operator: 'eq', value: f.operation.request.clientId }],
      } });
      expect(await getCoManagedManagementStatus(f.db, f.actor)).toMatchObject({ items: [], hasMore: false });
      await expect(withCoManagedManagementOperation(f.db, f.actor, f.operation.operation_id, async () => true)).rejects.toThrow();
    });

    it('retains published rules during commands and observes revocation before the next operation', async () => {
      const f = await fixture();
      await withCoManagedManagementOperation(f.db, f.actor, f.operation.operation_id, async () => {
        await expect(f.db.transaction(async trx => {
          await trx.raw("SET LOCAL lock_timeout = '50ms'");
          await tenantDb(trx, f.actor.tenant).table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId)
            .update({ config: { selectedClientIds: [f.otherClient] } });
        })).rejects.toMatchObject({ code: '55P03' });
      });
      await f.home.table('user_roles').where('role_id', f.roleId).delete();
      await expect(getCoManagedManagementOptions(f.db, f.actor)).rejects.toThrow();
      await expect(getCoManagedManagementStatus(f.db, f.actor)).rejects.toThrow();
      await f.home.table('user_roles').insert({ tenant: f.actor.tenant, user_id: f.actor.userId, role_id: f.roleId });
      await f.home.table('sessions').where('session_id', f.actor.sessionId).update({ expires_at: new Date(0) });
      await expect(getCoManagedManagementStatus(f.db, f.actor)).rejects.toThrow();
      await expect(withCoManagedManagementOperation(f.db, f.actor, f.operation.operation_id, async () => true)).rejects.toThrow();
    });

    it('reports expired invitation recovery without exposing the token or offering reset after account creation', async () => {
      const f = await fixture();
      await bootstrapCoManagedWorkspace(f.db, f.actor.tenant, f.operation.operation_id, { info() {}, warn() {}, error() {} });
      const customer = tenantDb(f.db, f.operation.customer_tenant);
      await customer.table('user_invitations').update({ expires_at: new Date(0) });
      await f.home.table('co_managed_provisioning_operations').update({ invitation_sent_at: new Date() });
      const invitation = await customer.table('user_invitations').first();
      const status = await getCoManagedManagementStatus(f.db, f.actor);
      expect(status.items[0]).toMatchObject({ invitationExpired: true, invitationSent: true, canRetry: true, canCancel: true });
      expect(JSON.stringify(status)).not.toContain(invitation.token);
      const id = randomUUID();
      await customer.table('users').insert({ tenant: f.operation.customer_tenant, user_id: id, username: id,
        email: invitation.email.toUpperCase(), first_name: 'Existing', last_name: 'Administrator', hashed_password: 'do-not-reset', user_type: 'internal', is_inactive: false });
      expect((await getCoManagedManagementStatus(f.db, f.actor)).items[0]).toMatchObject({ invitationExpired: false, canRetry: false, canCancel: false });
    });
  });

  describe('co-managed client target and read contracts', () => {
    async function secondOperation(f: Awaited<ReturnType<typeof fixture>>, clientId: string) {
      await f.home.table('co_managed_entitlements').update({ capacity: 10 });
      return prepareCoManagedProvisioning(f.db, { sponsorTenant: f.actor.tenant, clientId, requestedBy: f.actor.userId,
        escalationBoardId: f.operation.escalation_board_id, operationId: randomUUID(), seats: 1, visibilityMode: 'board_scope',
        workspaceName: 'Second workspace', administrator: { firstName: 'Second', lastName: 'Admin', email: `second-${randomUUID()}@example.test` } });
    }

    it('resolves an authorized sponsor-client selector to its exact relationship and reports admission-consistent usage', async () => {
      const f = await fixture();
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId: f.operation.request.clientId }))
        .resolves.toMatchObject({ kind: 'resolved', target: { side: 'sponsor', relationshipId: f.operation.relationship_id,
          operationId: f.operation.operation_id, customerTenant: f.operation.customer_tenant, ended: false } });
      await bootstrapCoManagedWorkspace(f.db, f.actor.tenant, f.operation.operation_id, { info() {}, warn() {}, error() {} });
      const customer = tenantDb(f.db, f.operation.customer_tenant);
      await customer.table('user_invitations').where('invitation_id', f.operation.administrator_invitation_id).update({ used_at: new Date() });
      const activeId = randomUUID();
      await customer.table('users').insert({ tenant: f.operation.customer_tenant, user_id: activeId, username: `tech-${activeId}`,
        email: `tech-${activeId}@example.test`, first_name: 'Active', last_name: 'Tech', hashed_password: 'test-not-a-login', user_type: 'internal', is_inactive: false });
      await customer.table('user_invitations').insert({ tenant: f.operation.customer_tenant, invitation_id: randomUUID(),
        email: `pending-${randomUUID()}@example.test`, first_name: 'Pending', last_name: 'Tech', token: `token-${randomUUID()}`,
        used_at: null, expires_at: new Date(Date.now() + 3600000), role_id: randomUUID(), metadata: {} });
      const view = await getCoManagedClientManagement(f.db, f.actor, f.operation.request.clientId);
      expect(view).toMatchObject({ clientId: f.operation.request.clientId, selectionRequired: false,
        selectedRelationshipId: f.operation.relationship_id, relationships: [{ operationId: f.operation.operation_id,
          canManage: true, seats: 2, usedSeats: 2 }] });
    });

    it('denies foreign clients and forged or mismatched relationship selections without leaking labels', async () => {
      const f = await fixture();
      const foreign = await prepare();
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId: foreign.request.clientId })).rejects.toThrow();
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId: f.otherClient })).rejects.toThrow();
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client',
        clientId: f.operation.request.clientId, relationshipId: foreign.relationship_id })).rejects.toThrow();
      await expect(getCoManagedClientManagement(f.db, f.actor, foreign.request.clientId)).rejects.toThrow();
      const view = await getCoManagedClientManagement(f.db, f.actor, f.operation.request.clientId);
      expect(view.clientName).toBe('Customer');
      expect(JSON.stringify(view)).not.toContain('Hidden');
    });

    it('requires an explicit selection for multiple current relationships and retains ended history', async () => {
      const f = await fixture();
      const clientId = f.operation.request.clientId;
      const second = await secondOperation(f, clientId);
      const ambiguous = await resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId });
      expect(ambiguous.kind).toBe('selection-required');
      if (ambiguous.kind !== 'selection-required') throw new Error('expected selection');
      expect(ambiguous.relationships.map(entry => entry.relationshipId).sort())
        .toEqual([f.operation.relationship_id, second.relationship_id].sort());
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId,
        relationshipId: second.relationship_id })).resolves.toMatchObject({ kind: 'resolved',
        target: { operationId: second.operation_id, relationshipId: second.relationship_id } });
      await tenantDb(f.db, f.operation.customer_tenant).table('co_management_relationships')
        .update({ state: 'terminated', ended_at: new Date() });
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId })).resolves
        .toMatchObject({ kind: 'resolved', target: { operationId: second.operation_id } });
      await tenantDb(f.db, second.customer_tenant).table('co_management_relationships')
        .update({ state: 'terminated', ended_at: new Date() });
      // Only terminated history remains: an explicit history selection is required.
      await expect(resolveCoManagedManagementTarget(f.db, f.actor, { kind: 'sponsor-client', clientId })).resolves
        .toMatchObject({ kind: 'selection-required' });
    });

    it('returns an authorized, searchable cross-client overview without hidden candidate counts', async () => {
      const f = await fixture();
      const overview = await getCoManagedClientOverview(f.db, f.actor);
      expect(overview).toMatchObject({ totalCount: 1, rows: [{ clientId: f.operation.request.clientId, clientName: 'Customer',
        relationshipId: f.operation.relationship_id, operationId: f.operation.operation_id, state: 'queued', seats: 2, canManage: true }] });
      expect((await getCoManagedClientOverview(f.db, f.actor, { search: 'Cust' })).totalCount).toBe(1);
      expect((await getCoManagedClientOverview(f.db, f.actor, { search: 'Hidden' })).totalCount).toBe(0);
      await f.home.table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId)
        .update({ config: { selectedClientIds: [f.operation.request.clientId], redactedFields: ['client_name'] } });
      expect((await getCoManagedClientOverview(f.db, f.actor)).rows[0].clientName).toBeNull();
    });

    it('maps a legacy operation to its authorized client and rejects a conflicting client selector', async () => {
      const f = await fixture();
      await expect(getCoManagedOperationTarget(f.db, f.actor, f.operation.operation_id)).resolves
        .toMatchObject({ clientId: f.operation.request.clientId, relationshipId: f.operation.relationship_id,
          operationId: f.operation.operation_id, workspaceName: 'Customer IT' });
      await expect(getCoManagedOperationTarget(f.db, f.actor, f.operation.operation_id, f.otherClient)).resolves.toBeNull();
      await expect(getCoManagedOperationTarget(f.db, f.actor, f.otherBoard)).resolves.toBeNull();
      await expect(getCoManagedOperationTarget(f.db, f.actor, f.operation.operation_id, f.operation.request.clientId))
        .resolves.toMatchObject({ relationshipId: f.operation.relationship_id });
    });

    it('keeps client Enable single-setup by resuming the current operation under different operation IDs', async () => {
      const f = await fixture();
      const clientId = randomUUID();
      await f.home.table('clients').insert({ tenant: f.actor.tenant, client_id: clientId, client_name: 'Fresh customer' });
      await f.home.table('authorization_bundle_rules').where('revision_id', f.clientPolicy.revisionId)
        .update({ config: { selectedClientIds: [f.operation.request.clientId, clientId] } });
      await f.home.table('co_managed_entitlements').update({ capacity: 10 });
      const request = { ...f.operation.request, clientId, operationId: randomUUID(), seats: 1 };
      const first = await prepareCoManagedProvisioningForActor(f.db, f.actor, request);
      const resumed = await prepareCoManagedProvisioningForActor(f.db, f.actor, { ...request, operationId: randomUUID() });
      expect(resumed.operation_id).toBe(first.operation_id);
      expect(await f.home.table('co_managed_provisioning_operations').whereRaw("lower(request->>'clientId') = ?", [clientId]))
        .toHaveLength(1);
    });
  });
}
