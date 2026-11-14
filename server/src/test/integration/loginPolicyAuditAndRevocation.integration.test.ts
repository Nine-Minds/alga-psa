import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

// Point the auth package's admin connection at the bootstrapped test database.
const dbHolder = vi.hoisted(() => ({ db: null as unknown as Knex }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => dbHolder.db,
}));

import {
  listBreakGlassCandidates,
  loadTenantAuthPolicy,
  recordForcedTwoFactorEnrollment,
  recordLoginRefusal,
  saveTenantAuthPolicy,
} from '@alga-psa/auth/lib/authPolicyStore';
import { applyPolicyChange, normalizeTenantAuthPolicy, validatePolicyChange } from '@alga-psa/auth/lib/authPolicy';

describe('login policy: tenant-scoped audits, atomic save, SSO-required revocation', () => {
  let db: Knex;
  let tenant: string;
  let adminId: string;
  let breakGlassId: string;
  let internalId: string;
  let ssoInternalId: string;
  let clientId: string;
  const sessionIds: Record<string, string> = {};

  async function insertSession(key: string, userId: string, loginMethod: string) {
    const [row] = await db('sessions')
      .insert({
        tenant,
        user_id: userId,
        token: '',
        login_method: loginMethod,
        expires_at: new Date(Date.now() + 3600_000),
      })
      .returning('session_id');
    sessionIds[key] = row.session_id;
  }

  async function currentSettings(): Promise<Record<string, any>> {
    const row = await db('tenant_settings').where({ tenant }).first();
    return typeof row?.settings === 'string' ? JSON.parse(row.settings) : (row?.settings ?? {});
  }

  async function auditRows(operation: string) {
    return db('audit_logs').where({ tenant, operation }).orderBy('timestamp');
  }

  beforeAll(async () => {
    dbHolder.db = db = await createTestDbConnection({ runSeeds: false });
    tenant = await createTenant(db, 'Login Policy Tenant');
    adminId = await createUser(db, tenant, { user_type: 'internal' });
    breakGlassId = await createUser(db, tenant, { user_type: 'internal', two_factor_enabled: true });
    internalId = await createUser(db, tenant, { user_type: 'internal' });
    ssoInternalId = await createUser(db, tenant, { user_type: 'internal' });
    clientId = await createUser(db, tenant, { user_type: 'client' });
  }, 240_000);

  afterAll(async () => {
    await db?.raw('DROP TRIGGER IF EXISTS test_fail_policy_audit ON audit_logs').catch(() => undefined);
    await db?.destroy();
  });

  beforeEach(async () => {
    await db('audit_logs').where({ tenant }).delete();
    await db('sessions').where({ tenant }).delete();
    await db('tenant_settings').where({ tenant }).delete();
    await db.raw('DROP TRIGGER IF EXISTS test_fail_policy_audit ON audit_logs');
  });

  it('writes exactly one tenant-scoped LOGIN_POLICY_CHANGED row with before/after values', async () => {
    const before = await loadTenantAuthPolicy(tenant, { bypassCache: true });
    const after = applyPolicyChange(before, { require2faForInternalUsers: true });

    await saveTenantAuthPolicy({
      knex: db,
      tenant,
      actorUserId: adminId,
      currentSettings: { keep: 'me' },
      before,
      after,
    });

    const rows = await auditRows('LOGIN_POLICY_CHANGED');
    expect(rows).toHaveLength(1);
    const changed = typeof rows[0].changed_data === 'string' ? JSON.parse(rows[0].changed_data) : rows[0].changed_data;
    expect(rows[0].user_id).toBe(adminId);
    expect(changed.before.require2faForInternalUsers).toBe(false);
    expect(changed.after.require2faForInternalUsers).toBe(true);
    expect(JSON.stringify(rows[0])).not.toMatch(/hashed_password|two_factor_secret|totp/i);

    const settings = await currentSettings();
    expect(settings.keep).toBe('me');
    expect(settings.sso.require2faForInternalUsers).toBe(true);
    expect((await loadTenantAuthPolicy(tenant)).require2faForInternalUsers).toBe(true);
  });

  it('writes refusal and forced-enrollment audits (best-effort paths now succeed)', async () => {
    await recordLoginRefusal({ tenant, userId: internalId, userType: 'internal', reason: 'sso_required', surface: 'msp_login' });
    await recordForcedTwoFactorEnrollment({ tenant, userId: internalId, surface: 'two_factor_enrollment' });

    expect(await auditRows('LOGIN_POLICY_REFUSED')).toHaveLength(1);
    expect(await auditRows('TWO_FACTOR_ENROLLED_BY_POLICY')).toHaveLength(1);
  });

  it('rolls the settings write back when the audit insert fails', async () => {
    await db('tenant_settings').insert({ tenant, settings: JSON.stringify({ sso: { marker: 'original' } }) });
    await db.raw(`
      CREATE OR REPLACE FUNCTION test_fail_policy_audit_fn() RETURNS trigger AS $$
      BEGIN
        IF NEW.operation = 'LOGIN_POLICY_CHANGED' THEN RAISE EXCEPTION 'forced audit failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.raw(`CREATE TRIGGER test_fail_policy_audit BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION test_fail_policy_audit_fn()`);

    const before = await loadTenantAuthPolicy(tenant, { bypassCache: true });
    const after = applyPolicyChange(before, { require2faForInternalUsers: true });
    await insertSession('pw', internalId, 'credentials');

    await expect(
      saveTenantAuthPolicy({ knex: db, tenant, actorUserId: adminId, currentSettings: await currentSettings(), before, after }),
    ).rejects.toThrow(/forced audit failure/);

    expect(await currentSettings()).toEqual({ sso: { marker: 'original' } });
    expect(await auditRows('LOGIN_POLICY_CHANGED')).toHaveLength(0);
    expect((await loadTenantAuthPolicy(tenant, { bypassCache: true })).require2faForInternalUsers).toBe(false);
  });

  it('does not revoke sessions when the save rolls back, and revokes only password sessions of non-break-glass internal users on off -> on', async () => {
    await insertSession('internal', internalId, 'credentials');
    await insertSession('admin', adminId, 'credentials');
    await insertSession('breakGlass', breakGlassId, 'credentials');
    await insertSession('sso', ssoInternalId, 'google');
    await insertSession('client', clientId, 'credentials');
    await db('sessions').where({ session_id: (await db('sessions').insert({
      tenant, user_id: internalId, token: '', login_method: 'credentials', expires_at: new Date(Date.now() + 3600_000),
      revoked_at: new Date('2020-01-01'), revoked_reason: 'user_logout',
    }).returning('session_id'))[0].session_id });

    const before = normalizeTenantAuthPolicy({});
    const after = applyPolicyChange(before, {
      requireSsoForInternalUsers: true,
      passwordBreakGlassUserIds: [breakGlassId],
    });
    const result = await saveTenantAuthPolicy({
      knex: db, tenant, actorUserId: adminId, currentSettings: {}, before, after,
    });
    expect(result.revokedSessions).toBe(2);

    const state = async (key: string) =>
      db('sessions').where({ tenant, session_id: sessionIds[key] }).first();
    for (const key of ['internal', 'admin']) {
      const row = await state(key);
      expect(row.revoked_at).not.toBeNull();
      expect(row.revoked_reason).toBe('login_policy_sso_required');
    }
    for (const key of ['breakGlass', 'sso', 'client']) {
      expect((await state(key)).revoked_at).toBeNull();
    }
    // The already-revoked session keeps its original reason.
    expect(await db('sessions').where({ tenant, revoked_reason: 'user_logout' })).toHaveLength(1);
    expect(await auditRows('LOGIN_POLICY_CHANGED')).toHaveLength(1);
  });

  it('does not revoke again when Require SSO is already on', async () => {
    const on = applyPolicyChange(normalizeTenantAuthPolicy({}), {
      requireSsoForInternalUsers: true,
      passwordBreakGlassUserIds: [breakGlassId],
    });
    await saveTenantAuthPolicy({ knex: db, tenant, actorUserId: adminId, currentSettings: {}, before: normalizeTenantAuthPolicy({}), after: on });
    await insertSession('late', internalId, 'credentials');

    const next = applyPolicyChange(on, { require2faForInternalUsers: true });
    const result = await saveTenantAuthPolicy({ knex: db, tenant, actorUserId: adminId, currentSettings: await currentSettings(), before: on, after: next });

    expect(result.revokedSessions).toBe(0);
    expect((await db('sessions').where({ session_id: sessionIds.late }).first()).revoked_at).toBeNull();
  });

  describe('stale break-glass ids (2FA reset after selection)', () => {
    let staleId: string;
    let validAdminId: string;
    let roleId: string;

    // Mirrors updateLoginPolicyAction: load stored policy, apply, validate against live candidates, prune, save.
    async function saveLikeAction(update: Parameters<typeof applyPolicyChange>[1]) {
      const settings = await currentSettings();
      const previous = normalizeTenantAuthPolicy(settings);
      const requested = applyPolicyChange(previous, update);
      const candidates = await listBreakGlassCandidates(tenant, requested.passwordBreakGlassUserIds);
      const guard = validatePolicyChange({
        next: requested,
        previous,
        hasConfiguredSsoProvider: true,
        breakGlassCandidates: candidates,
      });
      if (!guard.ok) return { guard };
      const after = { ...requested, passwordBreakGlassUserIds: guard.breakGlassUserIds };
      await saveTenantAuthPolicy({
        knex: db,
        tenant,
        actorUserId: adminId,
        currentSettings: settings,
        before: previous,
        after,
        prunedBreakGlassUserIds: guard.prunedBreakGlassUserIds,
      });
      return { guard };
    }

    beforeAll(async () => {
      roleId = (await db('roles').insert({ tenant, role_name: 'Admin', msp: true, client: false }).returning('role_id'))[0].role_id;
      staleId = await createUser(db, tenant, { user_type: 'internal', two_factor_enabled: true });
      validAdminId = await createUser(db, tenant, { user_type: 'internal', two_factor_enabled: true });
      await db('user_roles').insert([
        { tenant, user_id: staleId, role_id: roleId },
        { tenant, user_id: validAdminId, role_id: roleId },
      ]);
    });

    beforeEach(async () => {
      await db('users').where({ tenant, user_id: staleId }).update({ two_factor_enabled: true });
      // SSO on with the stale user stored as the break-glass admin.
      const on = applyPolicyChange(normalizeTenantAuthPolicy({}), {
        requireSsoForInternalUsers: true,
        passwordBreakGlassUserIds: [staleId],
      });
      await saveTenantAuthPolicy({ knex: db, tenant, actorUserId: adminId, currentSettings: {}, before: normalizeTenantAuthPolicy({}), after: on });
      await db('audit_logs').where({ tenant }).delete();
      // The admin then has their 2FA reset.
      await db('users').where({ tenant, user_id: staleId }).update({ two_factor_enabled: false });
    });

    it('turning Require SSO off succeeds, prunes the stored list and audits the pruned id', async () => {
      const { guard } = await saveLikeAction({ requireSsoForInternalUsers: false });
      expect(guard.ok).toBe(true);

      const settings = await currentSettings();
      expect(settings.sso.requireSsoForInternalUsers).toBe(false);
      expect(settings.sso.passwordBreakGlassUserIds).toEqual([]);
      expect(settings.sso.passwordAuthDisabledAt).toBeNull();

      const rows = await auditRows('LOGIN_POLICY_CHANGED');
      expect(rows).toHaveLength(1);
      const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : rows[0].details;
      expect(details.pruned_break_glass_user_ids).toEqual([staleId]);
    });

    it('a save with SSO on plus another valid admin succeeds and prunes the stale id', async () => {
      const { guard } = await saveLikeAction({ passwordBreakGlassUserIds: [staleId, validAdminId] });
      expect(guard.ok).toBe(true);

      const settings = await currentSettings();
      expect(settings.sso.requireSsoForInternalUsers).toBe(true);
      expect(settings.sso.passwordBreakGlassUserIds).toEqual([validAdminId]);
      const rows = await auditRows('LOGIN_POLICY_CHANGED');
      const details = typeof rows[0].details === 'string' ? JSON.parse(rows[0].details) : rows[0].details;
      expect(details.pruned_break_glass_user_ids).toEqual([staleId]);
    });

    it('a save with SSO on and only the stale admin is still refused and persists nothing', async () => {
      const { guard } = await saveLikeAction({ require2faForClientUsers: true });
      expect(guard.ok).toBe(false);
      expect(guard.errors).toEqual(['break_glass_required']);
      expect((await currentSettings()).sso.passwordBreakGlassUserIds).toEqual([staleId]);
      expect(await auditRows('LOGIN_POLICY_CHANGED')).toHaveLength(0);
    });
  });
});
