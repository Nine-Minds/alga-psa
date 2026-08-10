/**
 * T007 — callback persistence atomicity (DB-backed).
 *
 * A reconnect whose callback setup fails *after* the token exchange must leave
 * the previously connected provider fully working: old refresh token, old
 * client_id/profile pinning, and a subscription state that never contradicts
 * what actually exists in Graph.
 *
 * `persistMicrosoftEmailOAuthResult` is the exact function the
 * /api/auth/microsoft/callback route uses to write tokens and initialize the
 * webhook. Exercising it against real PostgreSQL with a failing
 * `setupWebhook` (plus a compensation ledger recording the Graph mutations the
 * setup performed) is the behavioral regression for the atomicity requirement.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  persistMicrosoftEmailOAuthResult,
  type MicrosoftEmailWebhookCompensationLedger,
} from '../../services/email/MicrosoftEmailOAuthResultPersistence';

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

function persistParams(providerId: string, overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
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

  it('T007: a reconnect whose callback setup fails before touching Graph leaves the original connection intact', async () => {
    const providerId = await seedConnectedProvider();

    const compensateCalls: MicrosoftEmailWebhookCompensationLedger[] = [];
    await expect(
      persistMicrosoftEmailOAuthResult(
        persistParams(providerId, {
          setupWebhook: async () => {
            throw new Error('webhook registration exploded');
          },
          compensateWebhook: async (ledger) => {
            compensateCalls.push({ ...ledger });
          },
        })
      )
    ).rejects.toThrow('webhook registration exploded');

    // No Graph mutation was recorded, so the old subscription is still live and
    // must be restored verbatim.
    expect(compensateCalls).toHaveLength(1);
    expect(compensateCalls[0]).toEqual({ deletedSubscriptionIds: [], createdSubscriptionIds: [] });

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

  it('restores a coherent polling state instead of resurrecting a subscription the failed setup deleted from Graph', async () => {
    const providerId = await seedConnectedProvider();

    const deletedSubs: string[] = [];
    let ledgerSeen: MicrosoftEmailWebhookCompensationLedger | null = null;
    await expect(
      persistMicrosoftEmailOAuthResult(
        persistParams(providerId, {
          setupWebhook: async (ctx) => {
            // Simulates registerWebhookSubscription: the adapter deletes the old
            // subscription, creates a replacement, then a later step explodes.
            ctx.webhookCompensation.onSubscriptionDeleted('old-sub');
            ctx.webhookCompensation.onSubscriptionCreated('new-sub');
            throw new Error('post-subscription step exploded');
          },
          compensateWebhook: async (ledger) => {
            ledgerSeen = { ...ledger };
            deletedSubs.push(...ledger.createdSubscriptionIds);
          },
        })
      )
    ).rejects.toThrow('post-subscription step exploded');

    // The ledger captured the Graph mutations and the caller compensated the
    // created subscription.
    expect(ledgerSeen).toEqual({
      deletedSubscriptionIds: ['old-sub'],
      createdSubscriptionIds: ['new-sub'],
    });
    expect(deletedSubs).toEqual(['new-sub']);

    // Tokens/issuer are restored, but the old subscription id (already deleted
    // in Graph) is NOT resurrected: the row lands on a coherent polling state
    // that the maintenance probe will rebuild.
    const config = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .first();
    expect(config).toMatchObject({
      client_id: 'old-client',
      client_secret: 'old-secret',
      microsoft_profile_id: OLD_PROFILE_ID,
      client_secret_ref: 'old-ref',
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_verification_token: 'old-token',
      delivery_mode: 'polling',
      webhook_silent_runs: 0,
      last_webhook_delivery_at: null,
    });
    expect(config.next_subscription_probe_at).toBeTruthy();
    const probeAt = new Date(config.next_subscription_probe_at).getTime();
    expect(probeAt).toBeGreaterThan(Date.now());
    expect(probeAt).toBeLessThanOrEqual(Date.now() + 25 * 60 * 60 * 1000);

    const provider = await tenantTable<any>('email_providers')
      .where('id', providerId)
      .first();
    expect(provider.status).toBe('connected');
    expect(provider.error_message).toBeNull();
  });

  it('retry after a compensated failure succeeds and leaves a single coherent row with no duplicate subscriptions', async () => {
    const providerId = await seedConnectedProvider();

    const deletedSubs: string[] = [];
    const compensateCalls: MicrosoftEmailWebhookCompensationLedger[] = [];
    const createdSubs: string[] = [];

    // Attempt 1: setup creates a replacement subscription then explodes. The
    // compensation deletes the created subscription.
    await expect(
      persistMicrosoftEmailOAuthResult(
        persistParams(providerId, {
          setupWebhook: async (ctx) => {
            ctx.webhookCompensation.onSubscriptionDeleted('old-sub');
            ctx.webhookCompensation.onSubscriptionCreated('new-sub-1');
            throw new Error('first attempt exploded');
          },
          compensateWebhook: async (ledger) => {
            compensateCalls.push({ ...ledger });
            deletedSubs.push(...ledger.createdSubscriptionIds);
          },
        })
      )
    ).rejects.toThrow('first attempt exploded');
    expect(deletedSubs).toEqual(['new-sub-1']);

    // Attempt 2: the reconnect is retried and completes cleanly with a brand-new
    // subscription. Compensation must not run again. The setup also persists the
    // subscription id + webhook delivery mode exactly as registerWebhookSubscription
    // does against the freshly written config row.
    await persistMicrosoftEmailOAuthResult(
      persistParams(providerId, {
        setupWebhook: async (ctx) => {
          ctx.webhookCompensation.onSubscriptionDeleted('old-sub');
          ctx.webhookCompensation.onSubscriptionCreated('new-sub-2');
          createdSubs.push('new-sub-2');
          await tenantTable('microsoft_email_provider_config')
            .where('email_provider_id', providerId)
            .update({
              webhook_subscription_id: 'new-sub-2',
              webhook_expires_at: new Date(Date.now() + 3600000).toISOString(),
              delivery_mode: 'webhook',
              webhook_silent_runs: 0,
              next_subscription_probe_at: null,
              updated_at: new Date(),
            });
        },
        compensateWebhook: async (ledger) => {
          compensateCalls.push({ ...ledger });
        },
      })
    );

    // Only one config row exists for the provider — no duplicate rows.
    const configRows = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .select('*');
    expect(configRows).toHaveLength(1);

    // The final row reflects the successful second attempt, not a mix.
    expect(configRows[0]).toMatchObject({
      client_id: 'new-client',
      client_secret: 'new-secret',
      microsoft_profile_id: NEW_PROFILE_ID,
      client_secret_ref: 'new-ref',
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      webhook_subscription_id: 'new-sub-2',
      delivery_mode: 'webhook',
    });

    // No duplicate Graph subscriptions: only the second attempt's subscription
    // is live/recorded, and the first attempt's was compensated away.
    expect(createdSubs).toEqual(['new-sub-2']);
    expect(deletedSubs).toEqual(['new-sub-1']);
    expect(compensateCalls).toHaveLength(1);
  });

  it('persists new tokens and issuer metadata atomically when setup succeeds', async () => {
    const providerId = await seedConnectedProvider();

    await persistMicrosoftEmailOAuthResult(
      persistParams(providerId, {
        setupWebhook: async () => {
          // no-op: setup succeeds, nothing to restore
        },
        compensateWebhook: async () => {
          throw new Error('compensation must not run on success');
        },
      })
    );

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
