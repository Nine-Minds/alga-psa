/**
 * Mitigation round — status reads are pure even for UNMIGRATED legacy tenants.
 *
 * The prior Teams/email status-purity test seeded a fully-migrated tenant
 * (profile + every consumer binding already present), which masked the real
 * defect: on a legacy tenant whose migration has never run,
 * `getMicrosoftIntegrationStatus()` still reached the migration helpers
 * (`ensureLegacyMicrosoftProfileBackfill`, `ensureMicrosoftConsumerBindingMigration`)
 * via `listMicrosoftProfilesForTenant`, `resolveMicrosoftProfileForConsumer`, and
 * `getMicrosoftEmailSetupReadiness` — writing profile/binding rows and tenant
 * secrets as a side effect of a settings page load.
 *
 * This suite seeds a TRUE legacy tenant: legacy Microsoft tenant secrets
 * present, legacy usage present (msp_sso login domain, Microsoft email + calendar
 * providers), but NO `microsoft_profiles` rows, NO
 * `microsoft_profile_consumer_bindings` rows, and no migration-completion marker.
 * It asserts the status read (the same action both the Microsoft email settings
 * page and the Teams settings page invoke) performs ZERO writes across the
 * profile/binding/provider-config tables and ZERO secret-provider writes, while
 * still returning a useful legacy status — and that an explicit mutation action
 * afterwards still performs the migration, so the pure read strands nobody.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { runWithApiKeyUser } from '@alga-psa/auth';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  getMicrosoftIntegrationStatus,
  listMicrosoftConsumerBindings,
  saveMicrosoftIntegrationSettings,
} from '@alga-psa/integrations/actions/integrations/microsoftActions';

const hoisted = vi.hoisted(() => ({
  tenantSecrets: new Map<string, string>(),
  secretWrites: [] as Array<{ tenant: string; key: string; value: string | null }>,
}));

let testDb: Knex;
let testTenant: string;
let sessionUserId: string;
let legacyEmailProviderId: string;

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft legacy tenant status read purity test fixture creates and removes tenant rows'
  );
}

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in Microsoft legacy tenant status read purity tests');
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testDb, tenant: testTenant }),
    getConnection: async () => testDb,
  };
});

// The action is wrapped with the real @alga-psa/auth/withAuth, which resolves
// the session user. Unwrap it to the tenant set by runWithTenant (the same
// shape the wrapped action receives in production).
vi.mock('@alga-psa/auth/withAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/auth/withAuth')>();
  return {
    ...actual,
    withAuth:
      (action: (...args: any[]) => Promise<unknown>) =>
      async (...args: any[]) => {
        const { getTenantContext } = await import('@alga-psa/db');
        const tenant = getTenantContext() || 'test-tenant';
        return action({ user_id: sessionUserId, user_type: 'internal', tenant }, { tenant }, ...args);
      },
  };
});

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

// Write-capturing secret provider: every setTenantSecret/deleteTenantSecret is
// recorded so the test can assert the status read never writes a secret. The
// legacy tenant's credentials live here as the legacy singleton keys.
vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async (_name: string, envVar?: string, fallback = '') =>
    (envVar ? process.env[envVar] : undefined) ?? fallback,
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, key: string) =>
      hoisted.tenantSecrets.get(`${tenant}:${key}`) || undefined,
    setTenantSecret: async (tenant: string, key: string, value: string | null) => {
      hoisted.secretWrites.push({ tenant, key, value });
    },
    deleteTenantSecret: async (tenant: string, key: string) => {
      hoisted.secretWrites.push({ tenant, key, value: null });
    },
    getAppSecret: async () => undefined,
  }),
}));

async function snapshot() {
  const [profileRows, bindingRows, configRows, providerRows, calendarRows, domainRows] = await Promise.all([
    tenantTable('microsoft_profiles').select('*'),
    tenantTable('microsoft_profile_consumer_bindings').select('*'),
    tenantTable('microsoft_email_provider_config').select('*'),
    tenantTable('email_providers').select('*'),
    tenantTable('calendar_providers').select('*'),
    tenantTable('msp_sso_tenant_login_domains').select('*'),
  ]);
  return JSON.stringify({
    profiles: profileRows,
    bindings: bindingRows,
    config: configRows,
    emailProviders: providerRows,
    calendarProviders: calendarRows,
    domains: domainRows,
  });
}

async function countRows(table: string): Promise<number> {
  const row = await tenantTable<{ count: string }>(table).count<{ count: string }>('* as count').first();
  return Number(row?.count ?? 0);
}

// The explicit mutation actions are guarded by canManageMicrosoftSettings
// (hasPermission('system_settings', 'update')). Grant the session user that
// permission through the real roles/permissions tables so the mutation half of
// this suite passes its auth guard in this DB-backed run.
async function grantSystemSettingsUpdate(connection: Knex, tenant: string, userId: string) {
  const roleId = uuidv4();
  await tenantDb(connection, tenant).table('users').insert({
    tenant,
    user_id: userId,
    username: `legacy-purity-${userId.slice(0, 8)}`,
    hashed_password: 'unused',
    user_type: 'internal',
    email: `legacy-purity-${userId.slice(0, 8)}@client.com`,
    created_at: new Date(),
    updated_at: new Date(),
  });

  await tenantDb(connection, tenant).table('roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Legacy Status Read Purity Test Role ${uuidv4().slice(0, 8)}`,
    description: 'Test role for the Microsoft legacy tenant status read purity test',
    msp: true,
    client: false,
    created_at: new Date(),
    updated_at: new Date(),
  });

  const existingPermission = await tenantDb(connection, tenant).table('permissions')
    .where({ resource: 'system_settings', action: 'update' })
    .first<{ permission_id: string }>('permission_id');
  const permissionId = existingPermission?.permission_id ?? uuidv4();
  if (!existingPermission) {
    await tenantDb(connection, tenant).table('permissions').insert({
      tenant,
      permission_id: permissionId,
      resource: 'system_settings',
      action: 'update',
      msp: true,
      client: false,
      created_at: new Date(),
    });
  }

  await tenantDb(connection, tenant).table('role_permissions').insert({
    tenant,
    role_id: roleId,
    permission_id: permissionId,
    created_at: new Date(),
  });

  await tenantDb(connection, tenant).table('user_roles').insert({
    tenant,
    user_id: userId,
    role_id: roleId,
    created_at: new Date(),
  });
}

describe('Microsoft legacy tenant status read purity (DB-backed)', () => {
  beforeAll(async () => {
    const secretsDir = path.resolve(__dirname, '../../../../secrets');
    const readSecret = (name: string) => {
      try {
        return fs.readFileSync(path.join(secretsDir, name), 'utf8').trim();
      } catch {
        return undefined;
      }
    };
    // Override unconditionally: .env.localtest points DB_PASSWORD_* at container
    // secret paths that do not exist on this host, and the secrets provider is
    // mocked below, so getSecret() falls back to these env vars.
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '5472';
    process.env.DB_USER_ADMIN = 'postgres';
    process.env.DB_USER_SERVER = 'app_user';
    process.env.DB_PASSWORD_ADMIN = readSecret('postgres_password') || 'postpass123';
    process.env.DB_PASSWORD_SERVER = readSecret('db_password_server') || 'postpass123';
    process.env.NODE_ENV = 'test';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    sessionUserId = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Legacy Tenant Purity Test Client',
      email: 'legacy-purity@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await grantSystemSettingsUpdate(testDb, testTenant, sessionUserId);

    // TRUE legacy tenant: legacy singleton Microsoft secrets + legacy usage, but
    // NO microsoft_profiles rows, NO consumer bindings, no migration marker.
    hoisted.tenantSecrets.set(`${testTenant}:microsoft_client_id`, 'legacy-client-id');
    hoisted.tenantSecrets.set(`${testTenant}:microsoft_client_secret`, 'legacy-client-secret');
    hoisted.tenantSecrets.set(`${testTenant}:microsoft_tenant_id`, 'directory-guid');

    await tenantTable('msp_sso_tenant_login_domains').insert({
      tenant: testTenant,
      domain: 'legacy.example.com',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    legacyEmailProviderId = uuidv4();
    const now = new Date();
    await tenantTable('email_providers').insert({
      id: legacyEmailProviderId,
      tenant: testTenant,
      provider_type: 'microsoft',
      provider_name: 'Legacy Mailbox',
      mailbox: `legacy-${uuidv4().slice(0, 8)}@client.com`,
      is_active: true,
      status: 'connected',
      error_message: null,
      created_at: now,
      updated_at: now,
    });
    await tenantTable('microsoft_email_provider_config').insert({
      email_provider_id: legacyEmailProviderId,
      tenant: testTenant,
      client_id: 'legacy-client-id',
      client_secret: 'legacy-secret',
      tenant_id: 'directory-guid',
      microsoft_profile_id: null,
      client_secret_ref: null,
      redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      folder_filters: JSON.stringify(['Inbox']),
      access_token: 'access',
      refresh_token: 'refresh',
      token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      webhook_subscription_id: null,
      webhook_verification_token: null,
      webhook_expires_at: null,
      last_subscription_renewal: null,
      delivery_mode: 'webhook',
      webhook_silent_runs: 0,
      next_subscription_probe_at: null,
      created_at: now,
      updated_at: now,
    });

    await tenantTable('calendar_providers').insert({
      id: uuidv4(),
      tenant: testTenant,
      provider_type: 'microsoft',
      provider_name: 'Legacy Calendar',
      calendar_id: `legacy-calendar-${uuidv4().slice(0, 8)}@client.com`,
      is_active: true,
      status: 'connected',
      error_message: null,
      created_at: now,
      updated_at: now,
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('user_roles').where('user_id', sessionUserId).delete();
      await tenantTable('role_permissions').delete();
      await tenantTable('roles').delete();
      await tenantTable('permissions').delete();
      await tenantTable('users').where('user_id', sessionUserId).delete();
      await tenantTable('msp_sso_tenant_login_domains').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantTable('calendar_providers').delete();
      await tenantTable('microsoft_profile_consumer_bindings').delete();
      await tenantTable('microsoft_profiles').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(async () => {
    // Tests may shuffle, and the explicit-mutation test legitimately migrates
    // this tenant. Reset the migration-visible state (and the secret-write log)
    // so every test starts from the pristine legacy tenant seeded in beforeAll.
    hoisted.secretWrites.length = 0;
    await tenantTable('microsoft_profile_consumer_bindings').delete();
    await tenantTable('microsoft_profiles').delete();
  });

  it('status read on an unmigrated legacy tenant is pure: zero table writes, zero secret writes, and a useful legacy status', async () => {
    expect(await countRows('microsoft_profiles')).toBe(0);
    expect(await countRows('microsoft_profile_consumer_bindings')).toBe(0);

    const before = await snapshot();

    // Both the Microsoft email settings page and the Teams settings page invoke
    // the same shared no-arg status action for their page loads.
    const status = await runWithApiKeyUser(
      { user_id: sessionUserId, tenant: testTenant },
      () => runWithTenant(testTenant, () => getMicrosoftIntegrationStatus())
    );

    // The read does not throw and reflects the legacy state.
    expect(status.success).toBe(true);
    expect(status.error).toBeUndefined();
    expect(status.emailSetup).toBeDefined();

    // The legacy credentials surface as an unmigrated/legacy profile view
    // WITHOUT materializing a profile row.
    expect(status.profiles).toHaveLength(1);
    const legacyView = status.profiles![0];
    expect(legacyView.isLegacyUnmigrated).toBe(true);
    expect(legacyView.profileId).toBe('legacy');
    expect(legacyView.displayName).toBe('Default Microsoft Profile');
    expect(legacyView.clientId).toBe('legacy-client-id');
    expect(legacyView.tenantId).toBe('directory-guid');
    expect(legacyView.clientSecretConfigured).toBe(true);
    expect(legacyView.readiness.ready).toBe(true);
    expect(legacyView.consumers).toEqual(expect.arrayContaining(['MSP SSO', 'Email', 'Calendar']));

    // The msp_sso interpretation populates the legacy config.
    expect(status.config).toMatchObject({
      clientId: 'legacy-client-id',
      tenantId: 'directory-guid',
      ready: true,
    });

    // Zero writes: no rows inserted or changed in any watched table.
    expect(await snapshot()).toBe(before);
    expect(await countRows('microsoft_profiles')).toBe(0);
    expect(await countRows('microsoft_profile_consumer_bindings')).toBe(0);
    const config = await tenantTable<any>('microsoft_email_provider_config').first();
    expect(config.microsoft_profile_id).toBeNull();
    expect(config.client_secret_ref).toBeNull();

    // Zero secret-provider writes.
    expect(hoisted.secretWrites).toEqual([]);
  });

  it('an explicit mutation action still performs the migration, so the pure read strands nobody', async () => {
    // Deliberate, user-initiated save: allowed to materialize the profile and
    // mirror the legacy secrets.
    const saveResult = await runWithApiKeyUser(
      { user_id: sessionUserId, tenant: testTenant },
      () => runWithTenant(testTenant, () =>
        saveMicrosoftIntegrationSettings({
          clientId: 'legacy-client-id',
          clientSecret: 'legacy-client-secret',
          tenantId: 'directory-guid',
        })
      )
    );
    expect(saveResult).toEqual({ success: true });

    const profiles = await tenantTable<any>('microsoft_profiles').select('*');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].client_id).toBe('legacy-client-id');
    expect(profiles[0].client_secret_ref).toMatch(/^microsoft_profile_.+_client_secret$/);
    expect(profiles[0].profile_id).not.toBe('legacy');

    // The migration machine still runs on explicit actions: binding the legacy
    // usage to the materialized profile.
    const bindingsResult = await runWithApiKeyUser(
      { user_id: sessionUserId, tenant: testTenant },
      () => runWithTenant(testTenant, () => listMicrosoftConsumerBindings())
    );
    expect(bindingsResult.success).toBe(true);
    const mspSsoBinding = bindingsResult.bindings?.find((binding) => binding.consumerType === 'msp_sso');
    expect(mspSsoBinding).toMatchObject({
      profileId: profiles[0].profile_id,
      profileDisplayName: 'Default Microsoft Profile',
    });

    // A follow-up status read now shows the REAL materialized profile, not the
    // synthetic legacy view — the pure read transitioned cleanly.
    const status = await runWithApiKeyUser(
      { user_id: sessionUserId, tenant: testTenant },
      () => runWithTenant(testTenant, () => getMicrosoftIntegrationStatus())
    );
    expect(status.success).toBe(true);
    expect(status.profiles).toHaveLength(1);
    expect(status.profiles![0].isLegacyUnmigrated).toBeUndefined();
    expect(status.profiles![0].profileId).toBe(profiles[0].profile_id);
  });
});
