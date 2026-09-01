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
import {
  MicrosoftGraphAdapter,
  MicrosoftSubscriptionError,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';

const OLD_PROFILE_ID = '00000000-0000-4000-8000-000000000001';
const NEW_PROFILE_ID = '00000000-0000-4000-8000-000000000002';

let testDb: Knex;
let testTenant: string;

/**
 * A controllable Microsoft Graph HTTP layer for the REAL adapter. `post`
 * returns an incrementing subscription id exactly like Graph does; `delete`
 * records what was deleted so the test can assert the compensation really
 * removed the orphaned subscription.
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

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft OAuth result persistence test fixture creates and removes tenant rows'
  );
}

// Route the service's connection acquisition at the test database/tenant. The
// real adapter persists its webhook subscription through getAdminConnection(),
// so that is also pointed at the test database.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: testTenant })),
    getAdminConnection: async () => testDb,
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

/**
 * Mirrors the callback route's webhook setup: build a REAL
 * MicrosoftGraphAdapter against the freshly-persisted rows, wire its Graph
 * mutations into the compensation ledger, and register the webhook. The
 * adapter's subscription-id persistence hits real PostgreSQL via the mocked
 * admin connection (testDb).
 */
function realAdapterSetup(ctx: {
  provider: Record<string, any>;
  config: Record<string, any>;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  webhookCompensation: {
    onSubscriptionDeleted(subscriptionId: string): void;
    onSubscriptionCreated(subscriptionId: string): void;
  };
}) {
  const { provider, config, accessToken, refreshToken, expiresAt, webhookCompensation } = ctx;
  const adapter = new MicrosoftGraphAdapter({
    id: provider.id,
    tenant: provider.tenant,
    name: provider.provider_name || provider.mailbox,
    provider_type: 'microsoft',
    mailbox: provider.mailbox,
    folder_to_monitor: 'Inbox',
    active: provider.is_active,
    webhook_notification_url: 'https://psa.example.com/api/email/webhooks/microsoft',
    webhook_subscription_id: config.webhook_subscription_id || null,
    webhook_verification_token: config.webhook_verification_token || 'test-token',
    webhook_expires_at: config.webhook_expires_at || null,
    provider_config: {
      client_id: config.client_id,
      client_secret: config.client_secret,
      tenant_id: config.tenant_id || null,
      access_token: accessToken,
      refresh_token: refreshToken || null,
      token_expires_at: expiresAt.toISOString(),
      microsoft_profile_id: config.microsoft_profile_id || undefined,
      client_secret_ref: config.client_secret_ref || undefined,
    },
  } as any);
  adapter.attachWebhookLifecycle({
    onSubscriptionDeleted: (subscriptionId) =>
      webhookCompensation.onSubscriptionDeleted(subscriptionId),
    onSubscriptionCreated: (subscriptionId) =>
      webhookCompensation.onSubscriptionCreated(subscriptionId),
  });
  return adapter;
}

const FAILURE_TRIGGER_NAME = 'alga_test_fail_ms_subscription_persist_trigger';
const FAILURE_FUNCTION_NAME = 'alga_test_fail_ms_subscription_persist';
// The exact subscription id the mocked Graph `post` returns on its first call.
const FIRST_ATTEMPT_SUBSCRIPTION_ID = 'new-sub-1';

async function installSubscriptionPersistFailureTrigger(): Promise<void> {
  await testDb.raw(`
    CREATE OR REPLACE FUNCTION ${FAILURE_FUNCTION_NAME}() RETURNS trigger AS $$
    BEGIN
      IF NEW.webhook_subscription_id = '${FIRST_ATTEMPT_SUBSCRIPTION_ID}' THEN
        RAISE EXCEPTION 'injected subscription-id persistence failure (${FIRST_ATTEMPT_SUBSCRIPTION_ID})';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER_NAME} ON microsoft_email_provider_config;
    CREATE TRIGGER ${FAILURE_TRIGGER_NAME}
    BEFORE UPDATE ON microsoft_email_provider_config
    FOR EACH ROW EXECUTE FUNCTION ${FAILURE_FUNCTION_NAME}();
  `);
}

async function dropSubscriptionPersistFailureTrigger(): Promise<void> {
  await testDb.raw(`
    DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER_NAME} ON microsoft_email_provider_config;
    DROP FUNCTION IF EXISTS ${FAILURE_FUNCTION_NAME}();
  `);
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

  it('T007c: a REAL subscription-id persistence failure propagates through the real adapter and is compensated (pre-fix code swallows it and fails this test)', async () => {
    const providerId = await seedConnectedProvider();

    const ledgerSeen: MicrosoftEmailWebhookCompensationLedger[] = [];
    // A real adapter whose deleteSubscription() records through the mocked
    // Graph HTTP layer, mirroring the callback route's compensation hook.
    const compensateWebhook = async (ledger: MicrosoftEmailWebhookCompensationLedger) => {
      ledgerSeen.push({ ...ledger });
      const compConfig = await tenantTable<any>('microsoft_email_provider_config')
        .where('email_provider_id', providerId)
        .first();
      const compProvider = await tenantTable<any>('email_providers')
        .where('id', providerId)
        .first();
      const compAdapter = new MicrosoftGraphAdapter({
        id: compProvider.id,
        tenant: compProvider.tenant,
        name: compProvider.provider_name,
        provider_type: 'microsoft',
        mailbox: compProvider.mailbox,
        folder_to_monitor: 'Inbox',
        active: compProvider.is_active,
        provider_config: {
          client_id: compConfig.client_id,
          client_secret: compConfig.client_secret,
          tenant_id: compConfig.tenant_id || null,
          access_token: 'x',
          refresh_token: 'y',
          token_expires_at: new Date().toISOString(),
        },
      } as any);
      for (const subscriptionId of ledger.createdSubscriptionIds) {
        await compAdapter.deleteSubscription(subscriptionId);
      }
    };

    await installSubscriptionPersistFailureTrigger();
    let capturedError: any;
    try {
      await persistMicrosoftEmailOAuthResult(
        persistParams(providerId, {
          setupWebhook: (ctx) => realAdapterSetup(ctx).registerWebhookSubscription(),
          compensateWebhook,
        })
      );
    } catch (error) {
      capturedError = error;
    } finally {
      await dropSubscriptionPersistFailureTrigger();
    }

    // The persistence failure must propagate as a MicrosoftSubscriptionError
    // (kind 'other', never the 'validation' polling fallback) and keep the
    // original DB error in its cause chain. Pre-fix, the adapter swallows the
    // UPDATE failure, so this call resolves and `capturedError` is undefined.
    expect(capturedError).toBeInstanceOf(MicrosoftSubscriptionError);
    expect((capturedError as MicrosoftSubscriptionError).kind).toBe('other');
    expect(String((capturedError as any)?.cause?.message ?? '')).toContain(
      'injected subscription-id persistence failure'
    );

    // The adapter created the new subscription and deleted the prior one in
    // Graph; the compensation then deleted the orphaned new subscription.
    expect(graphHttp.createdSubscriptions).toEqual([FIRST_ATTEMPT_SUBSCRIPTION_ID]);
    expect(graphHttp.deletedSubscriptions).toEqual([
      'old-sub',
      FIRST_ATTEMPT_SUBSCRIPTION_ID,
    ]);
    expect(ledgerSeen).toHaveLength(1);
    expect(ledgerSeen[0]).toEqual({
      deletedSubscriptionIds: ['old-sub'],
      createdSubscriptionIds: [FIRST_ATTEMPT_SUBSCRIPTION_ID],
    });

    // The row does NOT retain the new subscription id nor the deleted prior id:
    // it is restored to the prior connected snapshot on coherent polling.
    const config = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .first();
    expect(config.webhook_subscription_id).not.toBe(FIRST_ATTEMPT_SUBSCRIPTION_ID);
    expect(config.webhook_subscription_id).not.toBe('old-sub');
    expect(config).toMatchObject({
      client_id: 'old-client',
      client_secret: 'old-secret',
      microsoft_profile_id: OLD_PROFILE_ID,
      client_secret_ref: 'old-ref',
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      webhook_subscription_id: null,
      webhook_expires_at: null,
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

    // RETRY-SAFE: a second callback attempt with the transient failure cleared
    // completes cleanly — a fresh subscription, no duplicates, no compensation.
    const createdBeforeRetry = graphHttp.createdSubscriptions.length;
    const retryLedgers: MicrosoftEmailWebhookCompensationLedger[] = [];
    await persistMicrosoftEmailOAuthResult(
      persistParams(providerId, {
        setupWebhook: (ctx) => realAdapterSetup(ctx).registerWebhookSubscription(),
        compensateWebhook: async (ledger) => {
          retryLedgers.push({ ...ledger });
        },
      })
    );

    expect(graphHttp.createdSubscriptions).toEqual([
      FIRST_ATTEMPT_SUBSCRIPTION_ID,
      'new-sub-2',
    ]);
    expect(graphHttp.createdSubscriptions.length).toBe(createdBeforeRetry + 1);
    expect(retryLedgers).toHaveLength(0);

    const configRows = await tenantTable<any>('microsoft_email_provider_config')
      .where('email_provider_id', providerId)
      .select('*');
    expect(configRows).toHaveLength(1);
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
  });
});
