/**
 * Blocker 6 — Teams reads are pure.
 *
 * `getMicrosoftIntegrationStatus()` powers the Teams settings profile picker.
 * Loading it (the shared status read path) must make ZERO writes to
 * `microsoft_email_provider_config`, `microsoft_profile_consumer_bindings`, or
 * `microsoft_profiles` — including any legacy shape migration or readiness
 * logic buried in the read path. The email issuer backfill is opt-in and only
 * the Microsoft email settings flow passes `runIssuerBackfill: true`.
 *
 * This test seeds a fully-migrated tenant (profile + every consumer binding
 * already present, plus a legacy email provider that a non-opt-in backfill
 * would pin) and asserts the three tables are byte-identical before and after
 * the real action runs against real PostgreSQL.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, runWithTenant } from '@alga-psa/db';
import { runWithApiKeyUser } from '@alga-psa/auth';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { getMicrosoftIntegrationStatus } from '@alga-psa/integrations/actions/integrations/microsoftActions';

let testDb: Knex;
let testTenant: string;
let sessionUserId: string;
let legacyProfileId: string;

const tenantSecrets = new Map<string, string>();

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft Teams status read purity test fixture creates and removes tenant rows'
  );
}

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in Microsoft Teams status read purity tests');
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

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async (_name: string, envVar?: string, fallback = '') =>
    (envVar ? process.env[envVar] : undefined) ?? fallback,
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, key: string) =>
      tenantSecrets.get(`${tenant}:${key}`) || undefined,
    setTenantSecret: async () => undefined,
    getAppSecret: async () => undefined,
  }),
}));

async function snapshot(scope: { configRows: any[]; bindingRows: any[]; profileRows: any[] }) {
  return JSON.stringify({
    config: scope.configRows,
    bindings: scope.bindingRows,
    profiles: scope.profileRows,
  });
}

describe('Teams status read path purity (DB-backed)', () => {
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

    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    sessionUserId = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Teams Purity Test Client',
      email: 'teams-purity@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // A fully-migrated tenant: one active Email-capable profile whose client id
    // is the same as a legacy email provider's persisted client id. The
    // opt-in-only issuer backfill would pin that provider; if it ever ran on
    // this read path, the snapshot below would differ.
    legacyProfileId = uuidv4();
    const secretRef = `microsoft_profile_${legacyProfileId}_client_secret`;
    tenantSecrets.set(`${testTenant}:${secretRef}`, 'secret-value');
    await tenantTable('microsoft_profiles').insert({
      tenant: testTenant,
      profile_id: legacyProfileId,
      display_name: 'Legacy Match App',
      display_name_normalized: 'legacy match app',
      client_id: 'legacy-app-client',
      tenant_id: 'directory-tenant-guid',
      client_secret_ref: secretRef,
      capabilities: JSON.stringify(['msp_sso', 'email', 'calendar', 'teams']),
      is_default: true,
      is_archived: false,
      archived_at: null,
      created_by: null,
      updated_by: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Every visible consumer binding already present so the binding migration
    // helpers are no-ops.
    for (const consumerType of ['msp_sso', 'email', 'calendar', 'teams']) {
      await tenantTable('microsoft_profile_consumer_bindings').insert({
        tenant: testTenant,
        consumer_type: consumerType,
        profile_id: legacyProfileId,
        created_by: null,
        updated_by: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    // A legacy email provider the (opt-in only) issuer backfill would pin to
    // the profile above if it ran.
    const providerId = uuidv4();
    await tenantTable('email_providers').insert({
      id: providerId,
      tenant: testTenant,
      provider_type: 'microsoft',
      provider_name: 'Legacy Mailbox',
      mailbox: `legacy-${uuidv4().slice(0, 8)}@client.com`,
      is_active: true,
      status: 'connected',
      error_message: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await tenantTable('microsoft_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: testTenant,
      client_id: 'legacy-app-client',
      client_secret: 'legacy-secret',
      tenant_id: 'common',
      microsoft_profile_id: null,
      client_secret_ref: null,
      redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      folder_filters: JSON.stringify(['Inbox']),
      access_token: 'access',
      refresh_token: 'refresh',
      token_expires_at: new Date(Date.now() + 3600000).toISOString(),
      webhook_subscription_id: 'sub',
      webhook_verification_token: 'token',
      webhook_expires_at: new Date(Date.now() + 7200000).toISOString(),
      last_subscription_renewal: new Date(),
      delivery_mode: 'webhook',
      webhook_silent_runs: 0,
      next_subscription_probe_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Teams add-on present so the Teams picker path is exercised.
    await tenantTable('tenant_addons').insert({
      tenant: testTenant,
      addon_key: 'teams',
      expires_at: null,
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('tenant_addons').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantTable('microsoft_profile_consumer_bindings').delete();
      await tenantTable('microsoft_profiles').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  it('loads Teams/status read path without writing to email config, bindings, or profiles', async () => {
    // Order-independent: tests shuffle, so the opt-in test may have already
    // pinned the legacy provider. Start this read from an unpinned state so the
    // assertion below proves the read path itself never re-pins it.
    await tenantTable('microsoft_email_provider_config').update({
      microsoft_profile_id: null,
      client_secret_ref: null,
    });

    const readScope = async () => {
      const [configRows, bindingRows, profileRows] = await Promise.all([
        tenantTable('microsoft_email_provider_config').select('*'),
        tenantTable('microsoft_profile_consumer_bindings').select('*'),
        tenantTable('microsoft_profiles').select('*'),
      ]);
      return { configRows, bindingRows, profileRows };
    };

    const before = await snapshot(await readScope());

    const status = await runWithApiKeyUser(
      { user_id: sessionUserId, tenant: testTenant },
      () => runWithTenant(testTenant, () => getMicrosoftIntegrationStatus())
    );

    expect(status.success).toBe(true);
    expect(status.issuerBackfill).toBeUndefined();

    const after = await snapshot(await readScope());
    expect(after).toBe(before);

    // The legacy provider row is untouched: no email issuer pin, no secret ref.
    const config = await tenantTable<any>('microsoft_email_provider_config').first();
    expect(config.microsoft_profile_id).toBeNull();
    expect(config.client_secret_ref).toBeNull();
  });

  it('the opt-in path still backfills when explicitly requested by the email settings flow', async () => {
    const before = await snapshot(await (async () => {
      const [configRows, bindingRows, profileRows] = await Promise.all([
        tenantTable('microsoft_email_provider_config').select('*'),
        tenantTable('microsoft_profile_consumer_bindings').select('*'),
        tenantTable('microsoft_profiles').select('*'),
      ]);
      return { configRows, bindingRows, profileRows };
    })());

    const status = await runWithApiKeyUser(
      { user_id: sessionUserId, tenant: testTenant },
      () => runWithTenant(testTenant, () => getMicrosoftIntegrationStatus({ runIssuerBackfill: true }))
    );

    expect(status.success).toBe(true);
    expect(status.issuerBackfill).toMatchObject({ backfilled: 1 });
    expect(before).not.toBe(await snapshot(await (async () => {
      const [configRows, bindingRows, profileRows] = await Promise.all([
        tenantTable('microsoft_email_provider_config').select('*'),
        tenantTable('microsoft_profile_consumer_bindings').select('*'),
        tenantTable('microsoft_profiles').select('*'),
      ]);
      return { configRows, bindingRows, profileRows };
    })()));

    const config = await tenantTable<any>('microsoft_email_provider_config').first();
    expect(config.microsoft_profile_id).toBe(legacyProfileId);
    expect(config.client_secret_ref).toBe(`microsoft_profile_${legacyProfileId}_client_secret`);
  });
});
