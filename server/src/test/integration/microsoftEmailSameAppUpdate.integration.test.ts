/**
 * Same-app Update Provider webhook-subscription persistence (DB-backed).
 *
 * An ordinary update of a connected Microsoft provider with its already-current
 * app runs full webhook replacement through the REAL `updateEmailProvider`
 * server action: delete the prior Graph subscription, create a replacement,
 * persist it, and mark the provider connected. The provider must never land in
 * Error, and no nonexistent `microsoft_email_provider_config` column may ever
 * reach an UPDATE.
 *
 * Regression this guards (found live on HEAD 436ac967d1): after a successful
 * webhook replacement, `initializeProviderWebhook` called
 * `EmailProviderService.updateProvider` with `vendorConfig:
 * { ...provider_config, subscriptionId }`; `subscriptionId` is not a column, so
 * Postgres rejected the UPDATE, the action's catch marked the provider Error,
 * and the replacement Graph subscription id was never persisted a second time.
 * The adapter already persists `webhook_subscription_id`/`webhook_expires_at`
 * inside `registerWebhookSubscription` and rethrows DB failures so the
 * compensation ledger can delete the orphaned Graph subscription.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { updateEmailProvider } from '@alga-psa/integrations/actions/email-actions/emailProviderActions';
import { EmailProviderService } from '@alga-psa/integrations/services/email/EmailProviderService';

const PROFILE_CLIENT_ID = '11111111-aaaa-2222-bbbb-333333333333';
const PROFILE_TENANT_ID = 'directory-tenant-guid';
const PROFILE_SECRET = 'profile-secret-value';
const PRIOR_SUBSCRIPTION_ID = 'old-sub';

const testContext = vi.hoisted(() => ({
  tenant: '',
  appSecrets: new Map<string, string>(),
  tenantSecrets: new Map<string, string>(),
}));

// The global test setup mocks `@alga-psa/auth` and resolves the authenticated
// tenant through server/src/lib/db's getCurrentTenantId; point that at the test
// tenant so the real `updateEmailProvider` action runs in our workspace.
vi.mock('../../lib/db', () => ({
  getCurrentTenantId: () => testContext.tenant,
  createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: testContext.tenant })),
}));

/**
 * A controllable Microsoft Graph HTTP layer for the REAL adapter. `post`
 * returns an incrementing subscription id exactly like Graph does; `delete`
 * records what was deleted so the test can assert the prior subscription was
 * removed and the replacement was created exactly once.
 */
const graphHttp = vi.hoisted(() => {
  const deletedSubscriptions: string[] = [];
  const createdSubscriptions: string[] = [];
  const instance = () => ({
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => {
      const id = `new-sub-${createdSubscriptions.length + 1}`;
      createdSubscriptions.push(id);
      return {
        data: { id, expirationDateTime: new Date(Date.now() + 3600000).toISOString() },
      };
    }),
    delete: vi.fn(async (url: string) => {
      const id = String(url).split('/').filter(Boolean).pop() || '';
      deletedSubscriptions.push(id);
      return { data: {} };
    }),
    patch: vi.fn(async () => ({ data: {} })),
    interceptors: { request: { use: vi.fn() } },
  });
  return { instance, deletedSubscriptions, createdSubscriptions };
});

vi.mock('axios', () => ({
  default: {
    create: () => graphHttp.instance(),
    post: vi.fn(async () => ({
      data: { access_token: 'x', refresh_token: 'y', expires_in: 3600 },
    })),
  },
}));

let testDb: Knex;
let testTenant: string;
let profileId: string;
let profileSecretRef: string;

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft email same-app update test fixture creates and removes tenant rows'
  );
}

// Route the service/action connection acquisition at the test database/tenant.
// The real adapter persists its webhook subscription through the admin
// connection, so that is also pointed at the test database.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: async () => ({ knex: testDb, tenant: testTenant }),
    getAdminConnection: async () => testDb,
  };
});

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async (name: string) => testContext.appSecrets.get(name),
    getTenantSecret: async (tenant: string, name: string) =>
      testContext.tenantSecrets.get(`${tenant}:${name}`),
    setTenantSecret: async () => undefined,
    deleteTenantSecret: async () => undefined,
  }),
  getSecret: async (_name: string, envVar?: string, fallback = '') =>
    (envVar ? process.env[envVar] : undefined) ?? fallback,
}));

const WRITE_LOG_TABLE = 'alga_test_ms_sub_write_log';
const WRITE_LOG_FUNCTION = 'alga_test_ms_sub_write_log_fn';
const WRITE_LOG_TRIGGER = 'alga_test_ms_sub_write_log_trigger';

async function installSubscriptionWriteLog(): Promise<void> {
  await testDb.raw(`
    CREATE TABLE IF NOT EXISTS ${WRITE_LOG_TABLE} (
      id serial PRIMARY KEY,
      provider_id uuid NOT NULL,
      subscription_id text NOT NULL
    );
    CREATE OR REPLACE FUNCTION ${WRITE_LOG_FUNCTION}() RETURNS trigger AS $$
    BEGIN
      IF NEW.webhook_subscription_id IS DISTINCT FROM OLD.webhook_subscription_id THEN
        INSERT INTO ${WRITE_LOG_TABLE} (provider_id, subscription_id)
        VALUES (NEW.email_provider_id, NEW.webhook_subscription_id);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS ${WRITE_LOG_TRIGGER} ON microsoft_email_provider_config;
    CREATE TRIGGER ${WRITE_LOG_TRIGGER}
    BEFORE UPDATE ON microsoft_email_provider_config
    FOR EACH ROW EXECUTE FUNCTION ${WRITE_LOG_FUNCTION}();
  `);
}

async function dropSubscriptionWriteLog(): Promise<void> {
  await testDb.raw(`
    DROP TRIGGER IF EXISTS ${WRITE_LOG_TRIGGER} ON microsoft_email_provider_config;
    DROP FUNCTION IF EXISTS ${WRITE_LOG_FUNCTION}();
    DROP TABLE IF EXISTS ${WRITE_LOG_TABLE};
  `);
}

async function seedProfile(): Promise<string> {
  const id = uuidv4();
  const secretRef = `microsoft_profile_${id}_client_secret`;
  await tenantTable('microsoft_profiles').insert({
    tenant: testTenant,
    profile_id: id,
    display_name: 'Same-App Update Email App',
    display_name_normalized: 'same-app update email app',
    client_id: PROFILE_CLIENT_ID,
    tenant_id: PROFILE_TENANT_ID,
    client_secret_ref: secretRef,
    capabilities: JSON.stringify(['email']),
    is_default: true,
    is_archived: false,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  testContext.tenantSecrets.set(`${testTenant}:${secretRef}`, PROFILE_SECRET);
  return id;
}

async function seedConnectedProvider(overrides: {
  accessToken?: string;
  refreshToken?: string;
  webhookSubscriptionId?: string | null;
} = {}): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'microsoft',
    provider_name: 'Same-App Mailbox',
    mailbox: `same-app-${providerId.slice(0, 8)}@client.com`,
    is_active: true,
    status: 'connected',
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('microsoft_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: PROFILE_CLIENT_ID,
    client_secret: PROFILE_SECRET,
    tenant_id: PROFILE_TENANT_ID,
    microsoft_profile_id: profileId,
    client_secret_ref: profileSecretRef,
    redirect_uri: 'http://localhost:3340/api/auth/microsoft/callback',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: overrides.accessToken ?? 'access-before',
    refresh_token: overrides.refreshToken ?? 'refresh-before',
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    webhook_subscription_id: overrides.webhookSubscriptionId === undefined
      ? PRIOR_SUBSCRIPTION_ID
      : overrides.webhookSubscriptionId,
    webhook_verification_token: 'verify-token',
    webhook_expires_at: new Date(Date.now() + 7200000).toISOString(),
    last_subscription_renewal: now,
    delivery_mode: 'webhook',
    webhook_silent_runs: 0,
    next_subscription_probe_at: null,
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

function sameAppUpdatePayload() {
  return {
    tenant: testTenant,
    providerType: 'microsoft',
    providerName: 'Same-App Mailbox',
    senderDisplayName: null,
    mailbox: 'same-app@client.com',
    isActive: true,
    inboundTicketDefaultsId: null,
    // The form carries an explicit issuer choice plus mostly-empty config;
    // tokens and webhook state are preserved server-side.
    microsoftIssuer: { kind: 'profile', profileId, clientId: PROFILE_CLIENT_ID },
    microsoftConfig: {
      client_id: '',
      client_secret: '',
      tenant_id: '',
      auto_process_emails: true,
      folder_filters: ['Inbox'],
      max_emails_per_sync: 50,
    },
  };
}

describe('Microsoft same-app Update Provider webhook persistence (DB-backed)', () => {
  beforeAll(async () => {
    const secretsDir = path.resolve(__dirname, '../../../../secrets');
    const readSecret = (name: string) => {
      try {
        return fs.readFileSync(path.join(secretsDir, name), 'utf8').trim();
      } catch {
        return undefined;
      }
    };
    // .env.localtest points DB_PASSWORD_* at container secret paths that do
    // not exist on this host; point the test bootstrap at the real secrets.
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '5472';
    process.env.DB_USER_ADMIN = 'postgres';
    process.env.DB_USER_SERVER = 'app_user';
    process.env.DB_PASSWORD_ADMIN = readSecret('postgres_password') || 'postpass123';
    process.env.DB_PASSWORD_SERVER = readSecret('db_password_server') || 'postpass123';
    process.env.NODE_ENV = 'test';

    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    testContext.tenant = testTenant;
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Same-App Update Test Client',
      email: 'same-app-update@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
    profileId = await seedProfile();
    profileSecretRef = `microsoft_profile_${profileId}_client_secret`;
    await installSubscriptionWriteLog();
  }, 180_000);

  afterAll(async () => {
    await dropSubscriptionWriteLog();
    await tenantTable('microsoft_email_provider_config').delete();
    await tenantTable('email_providers').delete();
    await tenantTable('microsoft_profiles').delete();
    await tenantFixtureTable().where('tenant', testTenant).delete();
    await testDb.destroy();
  }, 30_000);

  beforeEach(() => {
    graphHttp.deletedSubscriptions.length = 0;
    graphHttp.createdSubscriptions.length = 0;
  });

  it('same-app update through the real updateEmailProvider action ends connected with a once-persisted replacement subscription', async () => {
    const providerId = await seedConnectedProvider();
    const providerTable = () => tenantTable('email_providers');
    const configTable = () => tenantTable('microsoft_email_provider_config');

    const beforeConfig = await configTable().where('email_provider_id', providerId).first();

    const result = await updateEmailProvider(providerId, sameAppUpdatePayload());

    // The action completed without a webhook/setup error and reported the
    // provider connected — never Error.
    expect(result.setupError).toBeUndefined();
    expect(result.provider.status).toBe('connected');

    // The seeded connected provider had a prior live subscription; the update
    // deletes it in Graph and creates exactly one replacement.
    expect(graphHttp.deletedSubscriptions).toEqual([PRIOR_SUBSCRIPTION_ID]);
    expect(graphHttp.createdSubscriptions).toEqual(['new-sub-1']);

    const provider = await providerTable().where('id', providerId).first();
    expect(provider.status).toBe('connected');
    expect(provider.error_message).toBeNull();

    const config = await configTable().where('email_provider_id', providerId).first();

    // Tokens and issuer pinning are byte-identical across the update.
    expect(config).toMatchObject({
      access_token: beforeConfig.access_token,
      refresh_token: beforeConfig.refresh_token,
      client_id: beforeConfig.client_id,
      microsoft_profile_id: beforeConfig.microsoft_profile_id,
      client_secret_ref: beforeConfig.client_secret_ref,
      client_secret: beforeConfig.client_secret,
      tenant_id: beforeConfig.tenant_id,
    });
    expect(config.access_token).toBe('access-before');
    expect(config.refresh_token).toBe('refresh-before');

    // The replacement subscription id is persisted in the real column
    // (webhook_subscription_id) with the new Graph expiry, and the prior id is
    // gone from the DB.
    expect(config.webhook_subscription_id).toBe('new-sub-1');
    expect(config.webhook_subscription_id).not.toBe(PRIOR_SUBSCRIPTION_ID);
    expect(config.webhook_expires_at).toBeTruthy();
    const expiryMs = new Date(config.webhook_expires_at).getTime();
    expect(expiryMs).toBeGreaterThan(Date.now());
    expect(expiryMs).toBeLessThanOrEqual(Date.now() + 2 * 60 * 60 * 1000);
    expect(config.delivery_mode).toBe('webhook');

    // Exactly one UPDATE ever wrote webhook_subscription_id (the adapter's
    // persistence); the removed `updateProvider` write would have attempted a
    // second, failing write instead.
    const writes = await testDb(WRITE_LOG_TABLE)
      .where({ provider_id: providerId })
      .select('subscription_id');
    expect(writes).toEqual([{ subscription_id: 'new-sub-1' }]);
    expect(writes).toHaveLength(1);
  });

  it('updateProvider drops non-column keys so a nonexistent column write can never recur', async () => {
    const providerId = await seedConnectedProvider();

    // This is the exact failure that landed providers in Error on HEAD: a
    // vendorConfig carrying `subscriptionId` (plus another non-column key).
    await new EmailProviderService().updateProvider(providerId, testTenant, {
      vendorConfig: {
        subscriptionId: 'not-a-column',
        resolved_client_id: 'not-a-column',
        webhook_subscription_id: 'injected-real-column',
        refresh_token: 'rotated-refresh',
      },
    });

    const config = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .first();

    // Real columns written through, non-column keys silently dropped.
    expect(config.webhook_subscription_id).toBe('injected-real-column');
    expect(config.refresh_token).toBe('rotated-refresh');
    expect(config.access_token).toBe('access-before');
    expect(config.client_id).toBe(PROFILE_CLIENT_ID);
    expect(config.microsoft_profile_id).toBe(profileId);

    // Prove `subscriptionId` is not a column and nothing was ever written for it.
    const columns = await testDb.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'microsoft_email_provider_config'
         AND column_name = 'subscriptionId'`
    );
    expect(columns.rows).toHaveLength(0);
  });
});
