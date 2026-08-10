/**
 * T007 — callback persistence atomicity (DB-backed).
 *
 * A reconnect whose callback setup fails *after* the token exchange must leave
 * the previously connected provider fully working: old refresh token, old
 * client_id/profile pinning, and old subscription state all restored.
 *
 * `persistMicrosoftEmailOAuthResult` is the exact function the
 * /api/auth/microsoft/callback route uses to write tokens and initialize the
 * webhook. Exercising it against real PostgreSQL with a failing
 * `setupWebhook` is the behavioral regression for the atomicity requirement.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { persistMicrosoftEmailOAuthResult } from '../../services/email/MicrosoftEmailOAuthResultPersistence';

const OLD_PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const NEW_PROFILE_ID = '00000000-0000-4000-8000-000000000002';

let testDb: Knex;
let testTenant: string;

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft OAuth result persistence test fixture creates and removes tenant rows'
  );
}

// Route the service's connection acquisition at the test database/tenant.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: testTenant })),
  };
});

async function seedConnectedProvider(overrides: { refreshToken?: string; clientId?: string; mailbox?: string } = {}) {
  const providerId = uuidv4();
  const now = new Date();
  const mailbox = overrides.mailbox ?? `reconnect-${uuidv4().slice(0, 8)}@client.com`;
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'microsoft',
    provider_name: 'Reconnect Mailbox',
    mailbox,
    is_active: true,
    status: 'connected',
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('microsoft_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: overrides.clientId ?? 'old-client',
    client_secret: 'old-secret',
    tenant_id: 'old-tenant-id',
    microsoft_profile_id: OLD_PROFILE_ID,
    client_secret_ref: 'old-ref',
    redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: 'old-access',
    refresh_token: overrides.refreshToken ?? 'old-refresh',
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    webhook_subscription_id: 'old-sub',
    webhook_verification_token: 'old-token',
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

describe('MicrosoftEmailOAuthResultPersistence (T007 atomicity)', () => {
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Test Client',
      email: 'test@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  afterAll(async () => {
    await tenantTable('microsoft_email_provider_config').delete();
    await tenantTable('email_providers').delete();
    await tenantFixtureTable().where('tenant', testTenant).delete();
    await testDb.destroy();
  });

  it('T007: a reconnect whose callback setup fails after token exchange leaves the original connection intact and functional', async () => {
    const providerId = await seedConnectedProvider();

    await expect(
      persistMicrosoftEmailOAuthResult({
        tenant: testTenant,
        providerId,
        tokens: {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
          expiresAt: new Date(Date.now() + 3600000),
        },
        issuerMetadata: {
          client_id: 'new-client',
          client_secret: 'new-secret',
          tenant_id: 'new-tenant-id',
          microsoft_profile_id: NEW_PROFILE_ID,
          client_secret_ref: 'new-ref',
        },
        setupWebhook: async () => {
          throw new Error('webhook registration exploded');
        },
      })
    ).rejects.toThrow('webhook registration exploded');

    // Old credentials, issuer pinning, and subscription state are all restored.
    const config = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .first();
    expect(config).toMatchObject({
      client_id: 'old-client',
      client_secret: 'old-secret',
      tenant_id: 'old-tenant-id',
      microsoft_profile_id: OLD_PROFILE_ID,
      client_secret_ref: 'old-ref',
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      webhook_subscription_id: 'old-sub',
      webhook_verification_token: 'old-token',
      delivery_mode: 'webhook',
    });

    const provider = await tenantTable<any>('email_providers')
      .where('id', providerId)
      .first();
    expect(provider.status).toBe('connected');
    expect(provider.error_message).toBeNull();
  });

  it('persists new tokens and issuer metadata atomically when setup succeeds', async () => {
    const providerId = await seedConnectedProvider();

    await persistMicrosoftEmailOAuthResult({
      tenant: testTenant,
      providerId,
      tokens: {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 3600000),
      },
      issuerMetadata: {
        client_id: 'new-client',
        client_secret: 'new-secret',
        tenant_id: 'new-tenant-id',
        microsoft_profile_id: NEW_PROFILE_ID,
        client_secret_ref: 'new-ref',
      },
      setupWebhook: async () => {
        // no-op: setup succeeds, nothing to restore
      },
    });

    const config = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .first();
    expect(config).toMatchObject({
      client_id: 'new-client',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      microsoft_profile_id: NEW_PROFILE_ID,
      client_secret_ref: 'new-ref',
    });

    const provider = await tenantTable<any>('email_providers')
      .where('id', providerId)
      .first();
    expect(provider.status).toBe('connected');
  });
});
