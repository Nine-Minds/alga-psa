import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

// Point the auth package's admin connection at the bootstrapped test database.
const dbHolder = vi.hoisted(() => ({ db: null as unknown as Knex }));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => dbHolder.db,
}));

import { loadTenantAuthPolicy, saveTenantAuthPolicy } from '@alga-psa/auth/lib/authPolicyStore';
import { applyPolicyChange, validatePolicyChange } from '@alga-psa/auth/lib/authPolicy';

describe('login policy: client portal SSO provider list (real tenant_settings + audit_logs)', () => {
  let db: Knex;
  let tenant: string;
  let adminId: string;

  async function currentSettings(): Promise<Record<string, any>> {
    const row = await db('tenant_settings').where({ tenant }).first();
    return typeof row?.settings === 'string' ? JSON.parse(row.settings) : (row?.settings ?? {});
  }

  beforeAll(async () => {
    dbHolder.db = db = await createTestDbConnection({ runSeeds: false });
    tenant = await createTenant(db, 'Client Portal SSO Tenant');
    adminId = await createUser(db, tenant, { user_type: 'internal' });
  }, 240_000);

  afterAll(async () => {
    await db?.destroy();
  });

  beforeEach(async () => {
    await db('audit_logs').where({ tenant }).delete();
    await db('tenant_settings').where({ tenant }).delete();
  });

  it('persists the list under settings.sso, keeps other sso keys, audits before/after and round-trips', async () => {
    await db('tenant_settings').insert({
      tenant,
      settings: JSON.stringify({ keep: 'me', sso: { autoLinkClient: true } }),
    });
    const stored = await currentSettings();

    const before = await loadTenantAuthPolicy(tenant, { bypassCache: true });
    expect(before.clientPortalSsoProviders).toBeNull();
    const after = applyPolicyChange(before, { clientPortalSsoProviders: ['azure-ad'] });

    await saveTenantAuthPolicy({ knex: db, tenant, actorUserId: adminId, currentSettings: stored, before, after });

    const settings = await currentSettings();
    expect(settings.keep).toBe('me');
    expect(settings.sso.autoLinkClient).toBe(true);
    expect(settings.sso.clientPortalSsoProviders).toEqual(['azure-ad']);

    const rows = await db('audit_logs').where({ tenant, operation: 'LOGIN_POLICY_CHANGED' });
    expect(rows).toHaveLength(1);
    const changed = typeof rows[0].changed_data === 'string' ? JSON.parse(rows[0].changed_data) : rows[0].changed_data;
    expect(changed.before.clientPortalSsoProviders).toBeNull();
    expect(changed.after.clientPortalSsoProviders).toEqual(['azure-ad']);

    expect((await loadTenantAuthPolicy(tenant)).clientPortalSsoProviders).toEqual(['azure-ad']);
    expect((await loadTenantAuthPolicy(tenant, { bypassCache: true })).clientPortalSsoProviders).toEqual(['azure-ad']);

    // An unrelated later save does not drop the list (undefined keeps it) and an explicit [] replaces it.
    const kept = applyPolicyChange(after, { require2faForClientUsers: true });
    expect(kept.clientPortalSsoProviders).toEqual(['azure-ad']);
    await saveTenantAuthPolicy({
      knex: db,
      tenant,
      actorUserId: adminId,
      currentSettings: await currentSettings(),
      before: after,
      after: applyPolicyChange(kept, { clientPortalSsoProviders: [] }),
    });
    expect((await currentSettings()).sso.clientPortalSsoProviders).toEqual([]);
    expect((await loadTenantAuthPolicy(tenant)).clientPortalSsoProviders).toEqual([]);
  });

  it('rejects an unsupported id at the guard and leaves tenant_settings untouched', async () => {
    const original = { sso: { autoLinkClient: true, clientPortalSsoProviders: ['google'] } };
    await db('tenant_settings').insert({ tenant, settings: JSON.stringify(original) });

    const previous = await loadTenantAuthPolicy(tenant, { bypassCache: true });
    const requestedList = ['azure-ad', 'okta'];
    const next = applyPolicyChange(previous, { clientPortalSsoProviders: requestedList as any });
    const guard = validatePolicyChange({
      next,
      previous,
      hasConfiguredSsoProvider: true,
      breakGlassCandidates: [],
      requestedClientPortalSsoProviders: requestedList,
    });

    expect(guard.ok).toBe(false);
    expect(guard.errors).toContain('client_portal_sso_provider_invalid');
    // The action stops here and never saves.
    expect(await currentSettings()).toEqual(original);
    expect(await db('audit_logs').where({ tenant, operation: 'LOGIN_POLICY_CHANGED' })).toHaveLength(0);
  });
});
