import type { Knex } from 'knex';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { getCoManagedEntitlementState, lockCoManagedSeatScope } from '@alga-psa/licensing';
import { acceptCoManagedRelationship, getCoManagedAcceptanceState } from '../../../../../../packages/co-managed/src/acceptance';
import { prepareCoManagedProvisioning, runCoManagedProvisioningStep, recordCoManagedProvisioningFailure, requestCoManagedProvisioningCleanup,
  type CoManagedProvisioningOperation } from '../../../../../../packages/co-managed/src/provisioning';
import { retryCoManagedInitialAdministratorInvitation } from '../../../../../../packages/co-managed/src/provisioningInvitation';
import { bootstrapCoManagedWorkspace } from '../../../db/co-managed-provisioning-operations';
import { bootstrapCoManagedCustomer, deliverCoManagedAdministratorInvitation } from '../../../activities/co-managed-provisioning-activities';
import { admitCoManagedSponsor } from '../../../../../../server/src/lib/co-managed/admitSponsor';
import { run as runFixtures } from '../../../../../../scripts/dev/co-managed-fixtures/index';
import { OZ, USERS } from '../../../../../../scripts/dev/co-managed-fixtures/base';
import { DISPOSABLE_CLIENTS, OZ_ESCALATION_BOARD } from '../../../../../../scripts/dev/co-managed-fixtures/L1a';
import { runOnboardingSeeds } from '../../../db/onboarding-seeds-operations';
import { getCoManagedManagementOptions } from '../../../../../../packages/co-managed/src/managementPolicy';
import { registerFeatureFlagChecker } from '@alga-psa/core/features';

interface Harness {
  getDb: () => Knex;
  prepare: (overrides?: { seats?: number; email?: string; capacity?: number }) => Promise<CoManagedProvisioningOperation>;
  delivery: { send: ReturnType<typeof vi.fn> };
  actorState: { user: any };
  appliance: { check: ReturnType<typeof vi.fn> };
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

export function registerCoManagedProvisioningTests({ getDb, prepare, delivery, actorState, appliance }: Harness) {
  const input = (operation: CoManagedProvisioningOperation) => ({ sponsorTenant: operation.tenant, operationId: operation.operation_id });
  const stored = (operation: CoManagedProvisioningOperation) =>
    tenantDb(getDb(), operation.tenant).table('co_managed_provisioning_operations').where('operation_id', operation.operation_id).first();
  const invitations = (operation: CoManagedProvisioningOperation) =>
    tenantDb(getDb(), operation.customer_tenant).table('user_invitations');

  beforeEach(() => { process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test'; });
  afterEach(() => { delivery.send.mockReset(); delivery.send.mockResolvedValue(true); messages.length = 0; delete process.env.FORCE_CAPABILITIES;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test'; });

  describe('co-managed provisioning', () => {
    it('keeps PSA invitation behavior and query count unchanged when the co-managed switch is off', async () => {
      const db = getDb(), operation = await prepare(), roleId = randomUUID();
      const sponsor = tenantDb(db, operation.tenant);
      await sponsor.table('roles').insert({ tenant: operation.tenant, role_id: roleId, role_name: `PSA ${roleId}`, msp: true, client: false });
      actorState.user = { tenant: operation.tenant, user_id: operation.requested_by, user_type: 'internal', username: 'admin' };
      appliance.check.mockResolvedValue(null);
      const { sendUserInvitation } = await import('../../../../../../packages/users/src/actions/user-actions/userInvitationActions');
      const captured: string[] = [];
      const record = (query: { sql: string }) => captured.push(query.sql);
      const invite = () => runWithTenant(operation.tenant, () => sendUserInvitation({ email: `${randomUUID()}@example.test`,
        firstName: 'PSA', lastName: 'User', roleId }));
      db.on('query', record);
      try {
        delete process.env.FORCE_CAPABILITIES;
        expect((await invite()).success).toBe(true);
        const ordinary = [...captured];
        captured.length = 0;
        process.env.FORCE_CAPABILITIES = 'co-managed:off';
        expect((await invite()).success).toBe(true);
        expect(captured.length).toBe(ordinary.length);
        expect([...ordinary, ...captured].some(sql => /co_manag/i.test(sql))).toBe(false);
      } finally {
        db.removeListener('query', record);
        appliance.check.mockReset();
        appliance.check.mockResolvedValue({ seats: 0 });
      }
    });

    it('keeps PSA token verification and cleanup at the existing query budget with the co-managed switch off', async () => {
      const db = getDb(), operation = await prepare(), token = randomUUID(), expiredToken = randomUUID();
      const sponsor = tenantDb(db, operation.tenant);
      await sponsor.table('user_invitations').insert([
        { tenant: operation.tenant, email: `${randomUUID()}@example.test`, first_name: 'PSA', last_name: 'Invite',
          token, expires_at: new Date(Date.now() + 3600000) },
        { tenant: operation.tenant, email: `${randomUUID()}@example.test`, first_name: 'Expired', last_name: 'Invite',
          token: expiredToken, expires_at: new Date(Date.now() - 60000) },
      ]);
      const { verifyUserInvitationToken } = await import('../../../../../../packages/users/src/actions/user-actions/userInvitationActions');
      const captured: string[] = [];
      const record = (query: { sql: string }) => captured.push(query.sql);
      db.on('query', record);
      try {
        const ordinary = await verifyUserInvitationToken(token);
        expect(ordinary.success).toBe(true);
        // Discovery, expired-token cleanup and invitation details; BEGIN/COMMIT are not queries.
        expect(captured.filter(sql => !/^(BEGIN|COMMIT);?$/.test(sql))).toHaveLength(3);
        const ordinaryCount = captured.length;
        captured.length = 0;
        process.env.FORCE_CAPABILITIES = 'co-managed:off';
        expect(await verifyUserInvitationToken(token)).toEqual(ordinary);
        expect(captured).toHaveLength(ordinaryCount);
        expect(captured.some(sql => /co_manag/i.test(sql))).toBe(false);
      } finally {
        db.removeListener('query', record);
      }
      expect(await sponsor.table('user_invitations').where('token', expiredToken)).toHaveLength(0);
    });

    it('completes the initial invitation through the public signup adapter and consumes it atomically', async () => {
      const db = getDb(), operation = await prepare();
      await bootstrapCoManagedCustomer(input(operation));
      const customer = tenantDb(db, operation.customer_tenant);
      const invitation = await customer.table('user_invitations').first();
      const { completeUserInvitationSetup, sendUserInvitation, verifyUserInvitationToken } = await import('../../../../../../packages/users/src/actions/user-actions/userInvitationActions');
      const expiredToken = randomUUID();
      await customer.table('user_invitations').insert({ tenant: operation.customer_tenant, email: `${randomUUID()}@example.test`,
        first_name: 'Expired', last_name: 'Invite', token: expiredToken, expires_at: new Date(Date.now() - 60000) });
      const rolesBefore = await customer.table('user_roles');
      const invitationsBefore = await customer.table('user_invitations').orderBy('invitation_id');
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      // The browser verifies the token before submitting a password. Neither
      // step may reveal invitation details or clean up rows while serving is off.
      expect(await verifyUserInvitationToken(invitation.token))
        .toEqual({ success: false, error: 'This feature is not available.', errorCode: 'CAPABILITY_UNAVAILABLE' });
      expect(await completeUserInvitationSetup(invitation.token, 'ValidPassword!2026'))
        .toMatchObject({ success: false, errorCode: 'CAPABILITY_UNAVAILABLE' });
      expect(await customer.table('user_invitations').orderBy('invitation_id')).toEqual(invitationsBefore);
      expect(await customer.table('users')).toHaveLength(0);
      expect(await customer.table('user_roles')).toEqual(rolesBefore);
      expect((await customer.table('user_invitations').where('token', invitation.token).first()).used_at).toBeNull();
      expect(await customer.table('user_invitations').where('token', expiredToken)).toHaveLength(1);
      delete process.env.FORCE_CAPABILITIES;
      const rolloutFlag = vi.fn(async () => false);
      registerFeatureFlagChecker(rolloutFlag);
      expect(await verifyUserInvitationToken(invitation.token)).toMatchObject({ success: true, invitee: { email: invitation.email } });
      expect(await customer.table('user_invitations').where('token', expiredToken)).toHaveLength(0);
      const result = await completeUserInvitationSetup(invitation.token, 'ValidPassword!2026');
      expect(result).toMatchObject({ success: true });
      expect(await customer.table('users').where({ email: invitation.email })).toHaveLength(1);
      expect((await customer.table('user_invitations').first()).used_at).not.toBeNull();
      expect(await customer.table('user_roles').where('user_id', result.userId)).toHaveLength(1);
      expect((await completeUserInvitationSetup(invitation.token, 'ValidPassword!2026')).success).toBe(false);
      const actor = { tenant: operation.customer_tenant, userId: result.userId! };
      const review = await getCoManagedAcceptanceState(db, actor);
      if (review.state !== 'pending_acceptance') throw new Error('No acceptance proposal');
      const lifecycle = await import('@alga-psa/licensing/lifecycle');
      lifecycle.registerCoManagedLifecycleProvider(lifecycle.coManagedLifecycleProvider);
      const apiKey = randomUUID();
      await customer.table('api_keys').insert({ tenant: actor.tenant, user_id: actor.userId,
        api_key: createHash('sha256').update(apiKey).digest('hex'), active: true });
      const { ApiKeyServiceForApi } = await import('../../../../../../server/src/lib/services/apiKeyServiceForApi');
      const beforeKey = await customer.table('api_keys').first();
      await expect(ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, actor.tenant))
        .rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
      await expect(ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey))
        .rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
      expect(await customer.table('api_keys').first()).toEqual(beforeKey);
      await acceptCoManagedRelationship(db, actor, { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint });
      expect(await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, actor.tenant)).toMatchObject({ user_id: actor.userId });
      expect(await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey)).toMatchObject({ user_id: actor.userId });
      expect(await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, operation.tenant)).toBeNull();
      // Exercise the actual RBAC reader against the role assigned by signup.
      // The harness mocks the action facade's permission helper, so do not use it here.
      const { hasPermission } = await import('../../../../../../packages/auth/src/lib/rbac');
      const signedUpAdmin = await customer.table('users').where('user_id', result.userId).first();
      expect(await hasPermission(signedUpAdmin, 'ticket', 'read', db)).toBe(true);
      expect(await hasPermission(signedUpAdmin, 'billing', 'read', db)).toBe(false);
      expect(await hasPermission(signedUpAdmin, 'document', 'read', db)).toBe(false);
      expect(await hasPermission({ ...signedUpAdmin, tenant: operation.tenant }, 'ticket', 'read', db)).toBe(false);
      const grants = await customer.table('role_permissions').orderBy(['role_id', 'permission_id']);
      await bootstrapCoManagedCustomer(input(operation));
      expect(await customer.table('role_permissions').orderBy(['role_id', 'permission_id'])).toEqual(grants);
      actorState.user = { tenant: actor.tenant, user_id: actor.userId, user_type: 'internal', username: invitation.email };
      const documentId = randomUUID(), typeId = randomUUID(), articleId = randomUUID();
      await customer.table('document_types').insert({ tenant: actor.tenant, type_id: typeId, type_name: 'kb-test' });
      await customer.table('documents').insert({ tenant: actor.tenant, document_id: documentId, document_name: 'Customer guide',
        type_id: typeId, user_id: actor.userId, created_by: actor.userId });
      await customer.table('kb_articles').insert({ tenant: actor.tenant, article_id: articleId, document_id: documentId, slug: 'customer-guide' });
      const { getArticles } = await import('../../../../../../packages/documents/src/actions/kbArticleActions');
      const articles = await runWithTenant(actor.tenant, () => getArticles());
      expect(articles).toMatchObject({ articles: expect.arrayContaining([expect.objectContaining({ article_id: articleId })]), total: 1 });
      const kbPermission = await customer.table('permissions').where({ resource: 'knowledge_base', action: 'read', msp: true }).first();
      await customer.table('role_permissions').where({ role_id: invitation.role_id, permission_id: kbPermission.permission_id }).delete();
      expect(await runWithTenant(actor.tenant, () => getArticles())).toMatchObject({ permissionError: expect.any(String) });
      await customer.table('role_permissions').insert({ tenant: actor.tenant, role_id: invitation.role_id, permission_id: kbPermission.permission_id });
      appliance.check.mockClear();
      const invite = (email: string) => runWithTenant(actor.tenant, () => sendUserInvitation({ email, firstName: 'Next', lastName: 'User', roleId: invitation.role_id }));
      const pendingBefore = await customer.table('user_invitations');
      delivery.send.mockClear();
      process.env.FORCE_CAPABILITIES = 'co-managed:off';
      expect(await invite(`blocked-${randomUUID()}@example.test`)).toMatchObject({ success: false, errorCode: 'CAPABILITY_UNAVAILABLE' });
      expect(await customer.table('user_invitations')).toEqual(pendingBefore);
      expect(delivery.send).not.toHaveBeenCalled();
      delete process.env.FORCE_CAPABILITIES;
      const attempts = await Promise.all([invite(`next-${randomUUID()}@example.test`), invite(`excess-${randomUUID()}@example.test`)]);
      const next = attempts.find(result => result.success)!;
      expect(attempts.filter(result => result.success)).toHaveLength(1);
      expect(attempts.find(result => !result.success)).toMatchObject({ errorCode: 'CO_MANAGED_SEAT_LIMIT' });
      const pending = await customer.table('user_invitations').where('invitation_id', next.invitationId).first();
      expect((await completeUserInvitationSetup(pending.token, 'ValidPassword!2026')).success).toBe(true);
      expect(await customer.table('users').where({ user_type: 'internal', is_inactive: false })).toHaveLength(2);
      expect(appliance.check).not.toHaveBeenCalled();
      expect(rolloutFlag).not.toHaveBeenCalled();
    });

    it('cannot consume the initial invitation while cancellation wins the shared lock', async () => {
      const db = getDb(), operation = await prepare();
      await bootstrapCoManagedCustomer(input(operation));
      const customer = tenantDb(db, operation.customer_tenant);
      const invitation = await customer.table('user_invitations').first();
      const { completeUserInvitationSetup } = await import('../../../../../../packages/users/src/actions/user-actions/userInvitationActions');
      let release!: () => void, locked!: () => void;
      const held = new Promise<void>(resolve => { locked = resolve; });
      const proceed = new Promise<void>(resolve => { release = resolve; });
      const cancellation = db.transaction(async trx => {
        await requestCoManagedProvisioningCleanup(trx, operation.tenant, operation.operation_id);
        locked(); await proceed;
      });
      await held;
      const signup = completeUserInvitationSetup(invitation.token, 'ValidPassword!2026');
      release(); await cancellation;
      expect((await signup).success).toBe(false);
      expect(await customer.table('users')).toHaveLength(0);
      expect((await customer.table('user_invitations').first()).used_at).toBeNull();
    });
    it('applies the L1a fixture twice and exposes an active escalation board in setup choices', async () => {
      const db = getDb();
      const engines = async () => ({ runOnboardingSeeds, verifyPassword: async () => true, secret: 'fixture-test-secret' });
      await runFixtures(db, { through: 'L1a', mode: 'apply' }, engines);
      await runFixtures(db, { through: 'L1a', mode: 'apply' }, engines);
      const oz = tenantDb(db, OZ), sessionId = randomUUID();
      expect(await oz.table('boards').where({ board_id: OZ_ESCALATION_BOARD, is_inactive: false })).toHaveLength(1);
      await admitCoManagedSponsor(OZ, db);
      const admin = USERS.find(u => u.slug === 'user/oz/admin')!;
      await oz.table('sessions').insert({ tenant: OZ, session_id: sessionId, user_id: admin.userId, expires_at: new Date(Date.now() + 3600000) });
      const choices = await getCoManagedManagementOptions(db, { kind: 'session', tenant: OZ, userId: admin.userId, sessionId }, '', DISPOSABLE_CLIENTS[0].clientId);
      expect(choices.boards).toEqual(expect.arrayContaining([expect.objectContaining({ id: OZ_ESCALATION_BOARD })]));
      expect(choices.clients).toEqual(expect.arrayContaining([expect.objectContaining({ id: DISPOSABLE_CLIENTS[0].clientId })]));
    });
    async function pendingCustomer() {
      const db = getDb(), operation = await prepare({ seats: 2 });
      await bootstrapCoManagedCustomer(input(operation));
      const customer = tenantDb(db, operation.customer_tenant), adminId = randomUUID();
      const invitation = await customer.table('user_invitations').where('invitation_id', operation.administrator_invitation_id).first();
      await customer.table('users').insert({ tenant: operation.customer_tenant, user_id: adminId, username: invitation.email,
        email: invitation.email, first_name: 'Customer', last_name: 'Admin', hashed_password: 'test', user_type: 'internal', is_inactive: false });
      await customer.table('user_roles').insert({ tenant: operation.customer_tenant, user_id: adminId, role_id: invitation.role_id });
      await customer.table('user_invitations').where('invitation_id', invitation.invitation_id).update({ used_at: db.fn.now() });
      const actor = { tenant: operation.customer_tenant, userId: adminId };
      const review = await getCoManagedAcceptanceState(db, actor);
      if (review.state !== 'pending_acceptance') throw new Error('No acceptance proposal');
      return { db, operation, customer, actor, input: { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint } };
    }

    it('rejects customer seat overflow without changing the relationship, allocation or receipts; exact capacity succeeds', async () => {
      const { db, operation, customer, actor, input: acceptance } = await pendingCustomer();
      const other = randomUUID();
      await customer.table('users').insert({ tenant: actor.tenant, user_id: other, username: `${other}@example.test`,
        email: `${other}@example.test`, user_type: 'internal', is_inactive: false, hashed_password: 'test' });
      await customer.table('user_invitations').insert({ tenant: actor.tenant, email: `pending-${other}@example.test`,
        first_name: 'Pending', last_name: 'User', token: randomUUID(), expires_at: new Date(Date.now() + 3600000) });
      const before = await customer.table('co_management_relationship_events').where('relationship_id', operation.relationship_id);
      await expect(acceptCoManagedRelationship(db, actor, acceptance)).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
      expect(await customer.table('co_management_relationships').first()).toMatchObject({ state: 'pending_acceptance', revision: 1 });
      expect(await tenantDb(db, operation.tenant).table('co_managed_allocations').first()).toMatchObject({ state: 'reserved' });
      expect(await customer.table('co_management_relationship_events').where('relationship_id', operation.relationship_id)).toEqual(before);
      await customer.table('users').where('user_id', other).delete();
      await customer.table('user_invitations').insert({ tenant: actor.tenant, email: `PENDING-${other}@EXAMPLE.TEST`,
        first_name: 'Pending', last_name: 'User', token: randomUUID(), expires_at: new Date(Date.now() + 3600000) });
      await acceptCoManagedRelationship(db, actor, acceptance);
      expect(await customer.table('co_management_relationships').first()).toMatchObject({ state: 'active', revision: 2 });
    });

    it('acceptance waits for concurrent seat admission and observes the committed seats', async () => {
      const { db, operation, customer, actor, input: acceptance } = await pendingCustomer();
      let release!: () => void, locked!: () => void;
      const lockedPromise = new Promise<void>(resolve => { locked = resolve; });
      const releasePromise = new Promise<void>(resolve => { release = resolve; });
      const writer = db.transaction(async trx => {
        await lockCoManagedSeatScope(trx, actor.tenant);
        const scoped = tenantDb(trx, actor.tenant);
        for (let i = 0; i < 2; i++) await scoped.table('user_invitations').insert({ tenant: actor.tenant,
          email: `${randomUUID()}@example.test`, first_name: 'Pending', last_name: 'User', token: randomUUID(), expires_at: new Date(Date.now() + 3600000) });
        locked(); await releasePromise;
      });
      await lockedPromise;
      const accepting = acceptCoManagedRelationship(db, actor, acceptance);
      release(); await writer;
      await expect(accepting).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE' });
      expect(await customer.table('co_management_relationships').first()).toMatchObject({ state: 'pending_acceptance', revision: 1 });
      expect(await customer.table('co_management_relationship_events').where({ event_type: 'accepted' })).toHaveLength(0);
      expect(await tenantDb(db, operation.tenant).table('co_managed_allocations').first()).toMatchObject({ state: 'reserved' });
    });
    it('admits a first-time entitled sponsor before provisioning without restoring revoked grants', async () => {
      const db = getDb(), tenant = randomUUID(), roleId = randomUUID();
      const home = tenantDb(db, tenant);
      await home.table('tenants').insert({ tenant, client_name: 'First sponsor', email: `${tenant}@example.test`, product_code: 'psa', plan: 'pro' });
      await home.table('roles').insert({ tenant, role_id: roleId, role_name: 'Admin', msp: true, client: false });
      await home.table('co_managed_entitlements').insert({ tenant, source: 'admin_grant', source_reference: 'test', capacity: 2,
        verified_at: new Date(), valid_until: new Date(Date.now() + 3600000) });
      await Promise.all([admitCoManagedSponsor(tenant, db), admitCoManagedSponsor(tenant, db)]);
      const permissions = await home.table('permissions').where({ resource: 'co_management' });
      expect(permissions.map(p => p.action).sort()).toEqual(['manage', 'read']);
      expect(await home.table('role_permissions').where('role_id', roleId)).toHaveLength(2);
      await home.table('role_permissions').where({ role_id: roleId, permission_id: permissions[0].permission_id }).delete();
      await admitCoManagedSponsor(tenant, db);
      expect(await home.table('role_permissions').where('role_id', roleId)).toHaveLength(1);
    });
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
      const events = await customer.table('co_management_relationship_events')
        .where('relationship_id', operation.relationship_id).select('event_type', 'revision');
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ event_type: 'requested', revision: 1 }),
        expect.objectContaining({ event_type: 'prepared', revision: 1 }),
      ]));
      expect(events).toHaveLength(2);
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
      await retryCoManagedInitialAdministratorInvitation(getDb(), await sponsorActor(getDb(), operation), operation.operation_id);
      await deliverCoManagedAdministratorInvitation(input(operation));
      expect(await stored(operation)).toMatchObject({ invitation_delivery_error: null });
      expect((await stored(operation)).invitation_sent_at).not.toBeNull();
    });

    it('allows one resend of a delivered invitation and then RESEND_LIMIT_REACHED', async () => {
      const db = getDb(), operation = await prepare();
      await bootstrapCoManagedCustomer(input(operation));
      await deliverCoManagedAdministratorInvitation(input(operation));
      const actor = await sponsorActor(db, operation);
      await retryCoManagedInitialAdministratorInvitation(db, actor, operation.operation_id);
      expect((await stored(operation)).invitation_sent_at).toBeNull();
      await deliverCoManagedAdministratorInvitation(input(operation));
      expect(delivery.send).toHaveBeenCalledTimes(2);
      await expect(retryCoManagedInitialAdministratorInvitation(db, actor, operation.operation_id))
        .rejects.toMatchObject({ code: 'RESEND_LIMIT_REACHED' });
      expect((await stored(operation)).invitation_sent_at).not.toBeNull(); // rejected resend changed nothing
      expect(delivery.send).toHaveBeenCalledTimes(2);
    });
  });
}
