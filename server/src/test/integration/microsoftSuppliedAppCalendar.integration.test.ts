/**
 * Outlook Calendar on the AlgaPSA-supplied Microsoft app (alga-2026-0003151).
 *
 * DB-backed. T001 setup + consent + calendar readiness; T002 consent-time
 * no-override; T003 reconcile-on-use (+ idempotency + concurrency); T004
 * reconcile no-op cases.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const PLATFORM_CLIENT_ID = '11111111-aaaa-4bbb-8ccc-platformapp01';
const hoisted = vi.hoisted(() => ({
  selfHosted: false,
  tenantSecrets: new Map<string, string>(),
  appSecrets: new Map<string, string>(),
  testDb: null as any,
  tenant: '',
}));

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in supplied-app calendar tests');
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: hoisted.testDb, tenant: hoisted.tenant }),
    getConnection: async () => hoisted.testDb,
  };
});
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => hoisted.testDb }));

vi.mock('@alga-psa/licensing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/licensing')>();
  return { ...actual, isSelfHostLicensing: async () => hoisted.selfHosted };
});

vi.mock('@alga-psa/auth/withAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth/withAuth')>();
  return {
    ...actual,
    withAuth:
      (action: (...args: any[]) => Promise<unknown>) =>
      async (...args: any[]) =>
        action({ user_id: '00000000-0000-4000-8000-000000000001', user_type: 'internal' }, { tenant: hoisted.tenant }, ...args),
  };
});
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async (_n: string, envVar?: string, fallback = '') => (envVar ? process.env[envVar] : undefined) ?? fallback,
  getSecretProviderInstance: async () => ({
    getAppSecret: async (name: string) => hoisted.appSecrets.get(name) || undefined,
    getTenantSecret: async (tenant: string, key: string) => hoisted.tenantSecrets.get(`${tenant}:${key}`) || undefined,
    setTenantSecret: async (tenant: string, key: string, value: string | null) => {
      if (value) hoisted.tenantSecrets.set(`${tenant}:${key}`, value);
      else hoisted.tenantSecrets.delete(`${tenant}:${key}`);
    },
    deleteTenantSecret: async (tenant: string, key: string) => {
      hoisted.tenantSecrets.delete(`${tenant}:${key}`);
    },
  }),
}));

import { configureMicrosoftEmailPlatformApplication } from '@alga-psa/integrations/actions/integrations/microsoftEmailSetupActions';
import { recordMicrosoftEmailAdminConsentFromState } from '@alga-psa/integrations/lib/microsoftEmailAdminConsent';
import { reconcileMicrosoftPlatformAppProfile } from '@alga-psa/integrations/lib/microsoftPlatformApp';
import { getMicrosoftCalendarSetupStatus } from '@alga-psa/ee-calendar/lib/actions/integrations/calendarSetupActions';

let testDb: Knex;
let tenant: string;
const MS_TENANT = '22222222-3333-4444-8555-666666666666';

const table = (name: string) => tenantDb(testDb, tenant).table<any>(name);

async function seedProfile(over: Record<string, unknown> = {}) {
  const profileId = uuidv4();
  const name = `profile-${profileId.slice(0, 8)}`;
  const now = new Date();
  await table('microsoft_profiles').insert({
    tenant,
    profile_id: profileId,
    display_name: name,
    display_name_normalized: name,
    client_id: PLATFORM_CLIENT_ID,
    tenant_id: MS_TENANT,
    client_secret_ref: `microsoft_profile_${profileId}_client_secret`,
    capabilities: JSON.stringify(['email']),
    email_admin_consent_required: true,
    email_admin_consent_granted_at: now,
    email_admin_consent_tenant_id: MS_TENANT,
    is_default: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
    ...over,
  });
  hoisted.tenantSecrets.set(`${tenant}:microsoft_profile_${profileId}_client_secret`, 'platform-secret');
  return profileId;
}

async function bind(consumer: string, profileId: string) {
  await table('microsoft_profile_consumer_bindings').insert({
    tenant, consumer_type: consumer, profile_id: profileId, created_at: new Date(), updated_at: new Date(),
  });
}

async function bindings(): Promise<Record<string, string>> {
  const rows = await table('microsoft_profile_consumer_bindings').select('consumer_type', 'profile_id');
  return Object.fromEntries(rows.map((r: any) => [r.consumer_type, r.profile_id]));
}

async function capabilitiesOf(profileId: string): Promise<string[]> {
  const row = await table('microsoft_profiles').where({ profile_id: profileId }).first();
  const caps = row.capabilities;
  return typeof caps === 'string' ? JSON.parse(caps) : caps;
}

describe('Outlook Calendar on the supplied Microsoft app (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.EDITION = 'ee';
    testDb = await createTestDbConnection();
    hoisted.testDb = testDb;
    tenant = uuidv4();
    hoisted.tenant = tenant;
    await tenantDb(testDb, tenant)
      .unscoped('tenants', 'supplied-app calendar test fixture creates and removes its tenant row')
      .insert({ tenant, client_name: 'Supplied App Calendar Test', email: 'supplied-cal@client.com', created_at: new Date(), updated_at: new Date() });
  }, 240_000);

  afterAll(async () => {
    if (tenant) {
      await table('microsoft_profile_consumer_bindings').delete();
      await table('microsoft_profiles').delete();
      await tenantDb(testDb, tenant).unscoped('tenants', 'supplied-app calendar test fixture cleanup').where('tenant', tenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(async () => {
    hoisted.selfHosted = false;
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.EDITION = 'ee';
    hoisted.appSecrets.clear();
    hoisted.appSecrets.set('MICROSOFT_CLIENT_ID', PLATFORM_CLIENT_ID);
    hoisted.appSecrets.set('MICROSOFT_CLIENT_SECRET', 'platform-secret');
    hoisted.appSecrets.set('NEXTAUTH_SECRET', 'test-signing-secret');
    hoisted.appSecrets.set('NEXT_PUBLIC_BASE_URL', 'https://psa.example.test');
    await table('microsoft_profile_consumer_bindings').delete();
    await table('microsoft_profiles').delete();
  });

  it('T001: setup + recorded consent leaves email+calendar capabilities and bindings; calendar is ready on the supplied app', async () => {
    const setup = await configureMicrosoftEmailPlatformApplication({ tenantId: MS_TENANT });
    expect(setup.success).toBe(true);
    const profileId = setup.profileId!;
    expect(setup.displayName).not.toMatch(/email/i);
    expect(await capabilitiesOf(profileId)).toEqual(['email', 'calendar']);

    // Pending consent: nothing bound yet, so calendar is not ready and reconcile skips it.
    expect(await bindings()).toEqual({});
    await reconcileMicrosoftPlatformAppProfile(tenant);
    expect(await bindings()).toEqual({});

    const consent = await recordMicrosoftEmailAdminConsentFromState({
      algaTenant: tenant, clientId: PLATFORM_CLIENT_ID, profileId, microsoftTenantId: MS_TENANT,
    });
    expect(consent.success).toBe(true);
    expect(await bindings()).toEqual({ email: profileId, calendar: profileId });

    const status = await getMicrosoftCalendarSetupStatus();
    expect(status).toMatchObject({ success: true, ready: true, state: 'ready', source: 'platform', platformOffered: true, profileId });
  });

  it('T002: consent keeps an existing Calendar binding to a tenant-owned profile and binds email only', async () => {
    const own = await seedProfile({ client_id: 'tenant-own-client', capabilities: JSON.stringify(['calendar']), email_admin_consent_required: false, email_admin_consent_granted_at: null, email_admin_consent_tenant_id: null });
    await bind('calendar', own);
    const platform = await seedProfile({ email_admin_consent_granted_at: null, email_admin_consent_tenant_id: null });

    const consent = await recordMicrosoftEmailAdminConsentFromState({
      algaTenant: tenant, clientId: PLATFORM_CLIENT_ID, profileId: platform, microsoftTenantId: MS_TENANT,
    });
    expect(consent.success).toBe(true);
    expect(await bindings()).toEqual({ email: platform, calendar: own });
    expect(await capabilitiesOf(own)).toEqual(['calendar']);

    const status = await getMicrosoftCalendarSetupStatus();
    expect(status).toMatchObject({ ready: true, source: 'tenant_app', profileId: own });
  });

  it('T003: a consented email-only platform profile gains calendar on first readiness read; reruns and concurrent runs add nothing more', async () => {
    const profileId = await seedProfile();
    await bind('email', profileId);

    const status = await getMicrosoftCalendarSetupStatus();
    expect(status).toMatchObject({ ready: true, source: 'platform', profileId });
    expect(await capabilitiesOf(profileId)).toEqual(['email', 'calendar']);
    expect(await bindings()).toEqual({ email: profileId, calendar: profileId });

    const rerun = await reconcileMicrosoftPlatformAppProfile(tenant);
    expect(rerun.changed).toBe(false);

    // Concurrency from a clean (unbound, email-only) state.
    await table('microsoft_profile_consumer_bindings').where({ consumer_type: 'calendar' }).delete();
    await table('microsoft_profiles').where({ profile_id: profileId }).update({ capabilities: JSON.stringify(['email']) });
    const results = await Promise.all(Array.from({ length: 6 }, () => reconcileMicrosoftPlatformAppProfile(tenant)));
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await bindings()).toEqual({ email: profileId, calendar: profileId });
    expect(await capabilitiesOf(profileId)).toEqual(['email', 'calendar']);
    const rows = await table('microsoft_profile_consumer_bindings').where({ consumer_type: 'calendar' });
    expect(rows).toHaveLength(1);
  });

  it('T003b: hand-extended profiles stay exactly as they are', async () => {
    const profileId = await seedProfile({ capabilities: JSON.stringify(['email', 'calendar', 'msp_sso']) });
    await bind('email', profileId);
    await bind('calendar', profileId);
    const before = await table('microsoft_profiles').where({ profile_id: profileId }).first();
    const result = await reconcileMicrosoftPlatformAppProfile(tenant);
    expect(result.changed).toBe(false);
    const after = await table('microsoft_profiles').where({ profile_id: profileId }).first();
    expect(after.updated_at).toEqual(before.updated_at);
    expect(await capabilitiesOf(profileId)).toEqual(['email', 'calendar', 'msp_sso']);
  });

  it('T004: reconcile does nothing for pending, archived, tenant-owned, other-bound and not-offered cases', async () => {
    // pending consent
    const pending = await seedProfile({ email_admin_consent_granted_at: null, email_admin_consent_tenant_id: null });
    // archived
    await seedProfile({ is_archived: true, archived_at: new Date() });
    // tenant-owned (consented, different client id)
    const own = await seedProfile({ client_id: 'tenant-own-client' });
    expect((await reconcileMicrosoftPlatformAppProfile(tenant)).changed).toBe(false);
    expect(await bindings()).toEqual({});
    expect(await capabilitiesOf(pending)).toEqual(['email']);
    expect(await capabilitiesOf(own)).toEqual(['email']);

    // calendar bound to another profile: consented platform profile is left alone for calendar
    const platform = await seedProfile();
    await bind('calendar', own);
    await bind('email', platform);
    expect((await reconcileMicrosoftPlatformAppProfile(tenant)).changed).toBe(false);
    expect(await bindings()).toEqual({ email: platform, calendar: own });
    expect(await capabilitiesOf(platform)).toEqual(['email']);
  });

  it('T004b: CE build (calendar not served) and self-hosted licensing never touch calendar', async () => {
    const profileId = await seedProfile();
    await bind('email', profileId);

    process.env.NEXT_PUBLIC_EDITION = 'community';
    process.env.EDITION = 'ce';
    expect((await reconcileMicrosoftPlatformAppProfile(tenant)).changed).toBe(false);

    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.EDITION = 'ee';
    hoisted.selfHosted = true;
    expect((await reconcileMicrosoftPlatformAppProfile(tenant)).changed).toBe(false);
    expect(await bindings()).toEqual({ email: profileId });
    expect(await capabilitiesOf(profileId)).toEqual(['email']);
    // Calendar readiness reports the supplied app as not offered.
    expect(await getMicrosoftCalendarSetupStatus()).toMatchObject({ success: true, ready: false, platformOffered: false, reasonCode: 'binding_not_configured' });
  });
});
