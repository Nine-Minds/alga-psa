/**
 * Behavioral, DB-backed tests for the real Microsoft inbound-email OAuth
 * callback route (`server/src/app/api/auth/microsoft/callback/route.ts`).
 *
 * These invoke the actual `GET` handler with constructed signed-state requests
 * against real PostgreSQL, so every blocker below is proven on the production
 * code path — not on an extracted helper:
 *
 *  1. Microsoft-error callbacks are fully guarded: the handler consumes the
 *     single-use nonce and runs the same relationship guard (session user,
 *     purpose, provider existence/tenant/type, issuer readiness) before it may
 *     mutate provider status. Forged / foreign / replayed error callbacks
 *     change nothing.
 *  2. Unsigned state at the callback is rejected outright (no dual acceptance).
 *  4. A post-token persistence failure reaches the ledger compensation: the
 *     Graph subscription the failed setup created is deleted and neither Graph
 *     nor DB is left with a stale subscription id.
 *  5. After compensation restores the provider to its prior connected/polling
 *     snapshot, the callback's outer handling does NOT mark it `error`.
 *
 * External Microsoft/secret/Graph-token infrastructure is stubbed (axios,
 * Graph adapter, secret provider); every database operation the route performs
 * is real. The nonce store runs its in-memory fallback (redis mocked away).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { runWithApiKeyUser } from '@alga-psa/auth';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  createMicrosoftEmailOAuthState,
  getMicrosoftEmailOAuthSigningSecret,
  type MicrosoftEmailOAuthPurpose,
} from '@alga-psa/integrations/utils/email/microsoftEmailOAuthState';
import { storeMicrosoftEmailOAuthNonce } from '@alga-psa/integrations/utils/email/microsoftEmailOAuthStateStore';
import { MICROSOFT_EMAIL_ISSUER_ERRORS } from '@alga-psa/integrations/lib/microsoftEmailIssuerSelection';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/auth/microsoft/callback/route';
import { POST as initiatePost } from '../../app/api/email/oauth/initiate/route';

const REDIRECT_URI = 'https://psa.example.com/api/auth/microsoft/callback';

let testDb: Knex;
let testTenant: string;
let sessionUserId: string;
let profileId: string;
let profileSecretRef: string;

/** Profile secrets the route's issuer revalidation resolves (filesystem store
 * has no per-tenant rows in tests, so the secret provider is stubbed). */
const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();

const capturedAdapterConfigs: any[] = [];
const deletedSubscriptions: string[] = [];
let failSetupWebhook = false;
let failSetupWebhookMessage = 'graph subscription persistence failed';

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft OAuth callback route test fixture creates and removes tenant rows'
  );
}

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in Microsoft OAuth callback route tests');
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
    getAppSecret: async (key: string) => appSecrets.get(key) || undefined,
  }),
}));

vi.mock('axios', () => ({
  default: {
    post: async () => ({
      data: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      },
    }),
  },
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftSubscriptionError: class MicrosoftSubscriptionError extends Error {
    constructor(public kind: string, message: string) {
      super(message);
    }
  },
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    lifecycle: {
      onSubscriptionDeleted?: (id: string) => void;
      onSubscriptionCreated?: (id: string) => void;
    } | null = null;

    constructor(public config: Record<string, any>) {
      capturedAdapterConfigs.push(config);
    }

    attachWebhookLifecycle(lifecycle: {
      onSubscriptionDeleted?: (id: string) => void;
      onSubscriptionCreated?: (id: string) => void;
    }) {
      this.lifecycle = lifecycle;
    }

    async connect() {}

    async registerWebhookSubscription() {
      if (failSetupWebhook) {
        // Simulates the real adapter deleting the old subscription, creating a
        // replacement, and then failing while persisting subscription state.
        this.lifecycle?.onSubscriptionDeleted?.('old-sub');
        this.lifecycle?.onSubscriptionCreated?.('new-sub');
        throw new Error(failSetupWebhookMessage);
      }
      return {};
    }

    async deleteSubscription(subscriptionId: string) {
      deletedSubscriptions.push(subscriptionId);
    }
  },
}));

vi.mock('@alga-psa/shared/services/email/EmailWebhookMaintenanceService', () => ({
  EmailWebhookMaintenanceService: class {
    async recordWebhookDeliveryMode() {}
    async usePollingDelivery() {
      return new Date(Date.now() + 3600000).toISOString();
    }
  },
}));

async function parsePostMessage(res: Response): Promise<Record<string, any>> {
  const html = await res.text();
  const match = /atob\('([^']+)'\)/.exec(html);
  if (!match) {
    throw new Error(`No postMessage payload found in callback response. Body: ${html.slice(0, 400)}`);
  }
  return JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
}

function callbackRequest(params: Record<string, string>): NextRequest {
  const qs = new URLSearchParams(params).toString();
  return new NextRequest(`http://localhost:3000/api/auth/microsoft/callback?${qs}`, {
    method: 'GET',
  });
}

async function invokeCallback(
  params: Record<string, string>,
  session: { user_id?: string; tenant?: string } = { user_id: sessionUserId, tenant: testTenant }
): Promise<{ response: Response; payload: Record<string, any> }> {
  const response = await runWithApiKeyUser(
    { user_id: session.user_id ?? sessionUserId, tenant: session.tenant ?? testTenant },
    () => GET(callbackRequest(params))
  );
  return { response, payload: await parsePostMessage(response) };
}

async function signAndStoreState(params: {
  purpose: MicrosoftEmailOAuthPurpose;
  providerId?: string;
  userId?: string;
  tenant?: string;
  clientId?: string;
  profileIdArg?: string;
}): Promise<string> {
  const secret = await getMicrosoftEmailOAuthSigningSecret();
  if (!secret) throw new Error('No state signing secret available');
  const signed = createMicrosoftEmailOAuthState({
    purpose: params.purpose,
    tenant: params.tenant ?? testTenant,
    userId: params.userId ?? sessionUserId,
    ...(params.providerId ? { providerId: params.providerId } : {}),
    issuer: {
      kind: 'profile',
      profileId: params.profileIdArg ?? profileId,
      clientId: params.clientId ?? 'profile-client-id',
    },
    clientId: params.clientId ?? 'profile-client-id',
    redirectUri: REDIRECT_URI,
    secret,
  });
  await storeMicrosoftEmailOAuthNonce(signed.payload.nonce);
  return signed.token;
}

async function seedProfile(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = uuidv4();
  const secretRef = `microsoft_profile_${id}_client_secret`;
  const clientId = String(overrides.client_id ?? 'profile-client-id');
  await tenantTable('microsoft_profiles').insert({
    tenant: testTenant,
    profile_id: id,
    display_name: 'Mailbox Email App',
    display_name_normalized: 'mailbox email app',
    client_id: clientId,
    tenant_id: 'directory-tenant-guid',
    client_secret_ref: secretRef,
    capabilities: JSON.stringify(['email']),
    is_default: true,
    is_archived: false,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });
  tenantSecrets.set(`${testTenant}:${secretRef}`, 'profile-secret-value');
  return id;
}

async function seedProvider(overrides: {
  refreshToken?: string | null;
  status?: string;
  microsoftProfileId?: string | null;
} = {}): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  const hasTokens = overrides.refreshToken !== null;
  const refreshToken = overrides.refreshToken === undefined ? 'old-refresh' : overrides.refreshToken;
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'microsoft',
    provider_name: 'Mailbox',
    mailbox: `box-${providerId.slice(0, 8)}@client.com`,
    is_active: true,
    status: overrides.status ?? (hasTokens ? 'connected' : 'configuring'),
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('microsoft_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: 'profile-client-id',
    client_secret: 'stored-secret',
    tenant_id: 'directory-tenant-guid',
    microsoft_profile_id: overrides.microsoftProfileId ?? profileId,
    client_secret_ref: profileSecretRef,
    redirect_uri: REDIRECT_URI,
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: 'old-access',
    refresh_token: refreshToken,
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

async function readProviderRow(providerId: string) {
  return tenantTable<any>('microsoft_email_provider_config')
    .where('email_provider_id', providerId)
    .first();
}

async function readProviderStatus(providerId: string) {
  return tenantTable<any>('email_providers').where('id', providerId).first();
}

describe('Microsoft email OAuth callback route (DB-backed behavioral)', () => {
  beforeAll(async () => {
    // Point DB-backed bootstrap at the local compose Postgres, resolving the
    // admin/app passwords from ./secrets (mocked secrets provider falls back
    // to env for getSecret).
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
      client_name: 'MS Callback Test Client',
      email: 'ms-callback@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
    profileId = await seedProfile();
    profileSecretRef = `microsoft_profile_${profileId}_client_secret`;
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantTable('microsoft_profiles').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(() => {
    capturedAdapterConfigs.length = 0;
    deletedSubscriptions.length = 0;
    failSetupWebhook = false;
    failSetupWebhookMessage = 'graph subscription persistence failed';
  });

  describe('success path', () => {
    it('success create: writes tokens + issuer pin atomically and returns success', async () => {
      const providerId = await seedProvider({ refreshToken: null });
      const state = await signAndStoreState({ purpose: 'create', providerId });

      const { payload } = await invokeCallback({ code: 'auth-code-create', state });

      expect(payload).toMatchObject({ type: 'oauth-callback', provider: 'microsoft', success: true });

      const config = await readProviderRow(providerId);
      expect(config).toMatchObject({
        client_id: 'profile-client-id',
        microsoft_profile_id: profileId,
        client_secret_ref: profileSecretRef,
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
      });
      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
    });

    it('success reconnect: refreshes tokens and keeps the pinned issuer', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId });

      const { payload } = await invokeCallback({ code: 'auth-code-reconnect', state });

      expect(payload).toMatchObject({ type: 'oauth-callback', provider: 'microsoft', success: true });

      const config = await readProviderRow(providerId);
      expect(config).toMatchObject({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        client_id: 'profile-client-id',
        microsoft_profile_id: profileId,
        client_secret_ref: profileSecretRef,
      });
      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
    });

    it('a signed state is single-use: the second callback with the same state is a replay and changes nothing', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId });

      const first = await invokeCallback({ code: 'auth-code-once', state });
      expect(first.payload.success).toBe(true);

      const second = await invokeCallback({ code: 'auth-code-twice', state });
      expect(second.payload.success).toBe(false);
      expect(second.payload.error).toBe(MICROSOFT_EMAIL_ISSUER_ERRORS.REPLAYED_STATE);

      // Tokens reflect only the first (consumed) callback.
      const config = await readProviderRow(providerId);
      expect(config.refresh_token).toBe('new-refresh-token');
    });
  });

  describe('blocker 2: the unsigned HTTP initiate path is gone for Microsoft', () => {
    it('rejects Microsoft initiation with no unsigned state (the signed server action is the only Microsoft path)', async () => {
      const request = new NextRequest('http://localhost:3000/api/email/oauth/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'microsoft' }),
      });

      const response = await runWithApiKeyUser(
        { user_id: sessionUserId, tenant: testTenant },
        () => initiatePost(request)
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).not.toHaveProperty('authUrl');
      expect(body).not.toHaveProperty('state');
      expect(String(body.error)).toContain('explicit application selection');
    });

    it('still serves the unsigned Google initiate (legacy path unaffected)', async () => {
      tenantSecrets.set(`${testTenant}:google_client_id`, 'google-client');
      const request = new NextRequest('http://localhost:3000/api/email/oauth/initiate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google' }),
      });

      const response = await runWithApiKeyUser(
        { user_id: sessionUserId, tenant: testTenant },
        () => initiatePost(request)
      );
      tenantSecrets.delete(`${testTenant}:google_client_id`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.provider).toBe('google');
    });
  });

  describe('blocker 1: Microsoft-error callbacks are fully guarded', () => {
    it('a valid signed error callback attributes the failure after consuming the nonce and running the guard', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId });

      const { payload } = await invokeCallback({ error: 'access_denied', state });
      expect(payload.success).toBe(false);

      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('error');
      expect(String(provider.error_message)).toContain('access_denied');

      // The error path consumed the nonce: a later success callback using the
      // same state is a replay and must NOT write tokens.
      const replay = await invokeCallback({ code: 'auth-code-after-error', state });
      expect(replay.payload.success).toBe(false);
      expect(replay.payload.error).toBe(MICROSOFT_EMAIL_ISSUER_ERRORS.REPLAYED_STATE);
      const config = await readProviderRow(providerId);
      expect(config.refresh_token).toBe('old-refresh');
    });

    it('a forged (tampered) error callback changes nothing', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId });
      const forged = `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`;

      const { payload } = await invokeCallback({ error: 'access_denied', state: forged });
      expect(payload.success).toBe(false);

      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
      expect(provider.error_message).toBeNull();
    });

    it('an unsigned base64 state at the callback is rejected outright (blocker 2 — no dual acceptance)', async () => {
      const providerId = await seedProvider({});
      const unsigned = Buffer.from(
        JSON.stringify({ tenant: testTenant, userId: sessionUserId, providerId, timestamp: Date.now() })
      ).toString('base64');

      const { payload } = await invokeCallback({ error: 'access_denied', state: unsigned });
      expect(payload.success).toBe(false);
      expect(payload.error).toBe(MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE);

      const successPayload = await invokeCallback({ code: 'unsigned-code', state: unsigned });
      expect(successPayload.payload.success).toBe(false);
      expect(successPayload.payload.error).toBe(MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE);

      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
      expect(provider.error_message).toBeNull();
    });

    it('a state signed for another user cannot attribute an error (foreign session)', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId, userId: 'some-other-user' });

      const { payload } = await invokeCallback({ error: 'access_denied', state }, {
        user_id: sessionUserId,
        tenant: testTenant,
      });
      expect(payload.success).toBe(false);

      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
      expect(provider.error_message).toBeNull();
    });

    it('a state signed for another workspace cannot attribute an error', async () => {
      const providerId = await seedProvider({});
      const otherTenant = uuidv4();
      await tenantFixtureTable()
        .insert({
          tenant: otherTenant,
          client_name: 'Other Workspace',
          email: 'other@workspace.com',
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict('tenant')
        .ignore();
      const state = await signAndStoreState({ purpose: 'reconnect', providerId, tenant: otherTenant });

      const { payload } = await invokeCallback({ error: 'access_denied', state }, {
        user_id: sessionUserId,
        tenant: testTenant,
      });
      expect(payload.success).toBe(false);

      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
      expect(provider.error_message).toBeNull();
    });

    it('a replayed error callback (nonce already consumed) does not write again', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId });

      const first = await invokeCallback({ error: 'access_denied', state });
      expect(first.payload.success).toBe(false);

      // Second error callback with the same state: nonce already consumed.
      const second = await invokeCallback({ error: 'access_denied', state });
      expect(second.payload.success).toBe(false);

      // Exactly one attribution; error_message is stable.
      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('error');
      expect(String(provider.error_message)).toContain('access_denied');
    });
  });

  describe('blockers 4+5: post-token persistence failure reaches compensation and never marks error', () => {
    it('when subscription persistence fails after Graph create/delete, compensation deletes the created subscription, the restored row has no stale subscription id, and the provider is NOT marked error', async () => {
      const providerId = await seedProvider({});
      const state = await signAndStoreState({ purpose: 'reconnect', providerId });

      failSetupWebhook = true;
      failSetupWebhookMessage = 'failed persisting webhook subscription state to database';

      const { payload } = await invokeCallback({ code: 'auth-code-persist-fail', state });
      expect(payload.success).toBe(false);
      expect(payload.error).toBe(MICROSOFT_EMAIL_ISSUER_ERRORS.CALLBACK_PERSISTENCE_FAILED);

      // The compensation deleted the Graph subscription the failed setup created.
      expect(deletedSubscriptions).toEqual(['new-sub']);

      // DB is restored to the prior connected snapshot with NO stale
      // subscription id (the old subscription was deleted from Graph by the
      // failed setup, so the row lands on coherent polling).
      const config = await readProviderRow(providerId);
      expect(config).toMatchObject({
        client_id: 'profile-client-id',
        microsoft_profile_id: profileId,
        client_secret_ref: profileSecretRef,
        access_token: 'old-access',
        refresh_token: 'old-refresh',
        webhook_subscription_id: null,
        webhook_expires_at: null,
        delivery_mode: 'polling',
        webhook_silent_runs: 0,
        last_webhook_delivery_at: null,
      });
      expect(config.webhook_subscription_id).not.toBe('new-sub');
      expect(config.webhook_subscription_id).not.toBe('old-sub');

      // Blocker 5: the outer callback error handling must NOT have marked the
      // restored provider `error`.
      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
      expect(provider.error_message).toBeNull();
    });

    it('a retry after a compensated persistence failure completes cleanly with no duplicate subscriptions', async () => {
      const providerId = await seedProvider({});
      const deletedSubs: string[] = [];

      failSetupWebhook = true;
      const state1 = await signAndStoreState({ purpose: 'reconnect', providerId });
      const first = await invokeCallback({ code: 'code-attempt-1', state: state1 });
      expect(first.payload.success).toBe(false);
      deletedSubs.push(...deletedSubscriptions);
      expect(deletedSubs).toEqual(['new-sub']);

      // Retry with a fresh signed state completes cleanly.
      failSetupWebhook = false;
      const state2 = await signAndStoreState({ purpose: 'reconnect', providerId });
      const second = await invokeCallback({ code: 'code-attempt-2', state: state2 });
      expect(second.payload.success).toBe(true);

      // Single coherent row, no stale deleted subscription id, no error status.
      const rows = await tenantTable<any>('microsoft_email_provider_config')
        .where('email_provider_id', providerId)
        .select('*');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        client_id: 'profile-client-id',
        microsoft_profile_id: profileId,
      });
      // The failed attempt's subscription was deleted from Graph; neither the
      // deleted id nor the failed attempt's id is persisted (the stub adapter
      // records no replacement subscription on the clean retry).
      expect(rows[0].webhook_subscription_id).not.toBe('new-sub');
      expect(rows[0].webhook_subscription_id).not.toBe('old-sub');
      const provider = await readProviderStatus(providerId);
      expect(provider.status).toBe('connected');
      expect(provider.error_message).toBeNull();
    });
  });
});
