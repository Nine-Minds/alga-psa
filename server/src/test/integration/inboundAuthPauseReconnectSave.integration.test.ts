/**
 * Behavioral integration tests for the auth-pause RECONNECT SAVE path — the
 * exact `updateEmailProvider(providerId, payload, skipAutomation)` call the
 * provider forms' Reconnect drawer makes (ImapProviderForm passes
 * skipAutomation=true). A credential-bearing save for a provider auto-paused
 * on repeated auth failures must route through the lifecycle recovery:
 * validate the submitted credentials against the source, atomically clear the
 * pause + auth-failure counters + stale IMAP cursors (the pause-window
 * backfill arming), and only then report success. Recovery must NOT fire for
 * unrelated saves on healthy or manually-paused providers, and invalid
 * credentials must leave the pause intact and surface an error.
 *
 * The Google siblings cover the OAuth reconnect path: a paused provider's
 * save must surface recovery failure (watch registration failure, missing
 * OAuth tokens, or automation-skipped saves) and never report success while
 * the pause persists, while a genuine watch re-registration resumes the
 * provider end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { updateEmailProvider } from '@alga-psa/integrations/actions/email-actions/emailProviderActions';

const describeDb = await describeWithDb();

let testDb: Knex;
let testTenant: string;

const imapFlowMock = vi.hoisted(() => ({
  instances: [] as any[],
  connectShouldFail: false,
}));
const secretsMock = vi.hoisted(() => ({
  store: new Map<string, string>(),
}));
const pubsubMock = vi.hoisted(() => ({
  calls: [] as any[],
}));
const gmailWatchMock = vi.hoisted(() => ({
  instances: [] as any[],
  registerShouldFail: false,
}));
const gmailAdapterMock = vi.hoisted(() => ({
  instances: [] as any[],
  testConnectionShouldFail: false,
  listMessagesSinceCalls: [] as any[],
}));

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in auth-pause reconnect save tests');
  },
}));

// Route the action's tenant resolution (global withAuth mock) at our test
// tenant, same harness as emailProviderCreation.test.ts.
vi.mock('../../lib/db', () => ({
  getCurrentTenantId: () => testTenant,
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: testTenant })),
  };
});

// The lifecycle recovery service resolves its own admin connection.
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

// In-memory tenant secrets: persistImapConfig writes the submitted password,
// credential validation reads it back — proving validation runs against the
// credentials that were just saved.
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, key: string) =>
      secretsMock.store.get(`${tenant}:${key}`) ?? null,
    setTenantSecret: async (tenant: string, key: string, value: string) => {
      secretsMock.store.set(`${tenant}:${key}`, value);
    },
    getAppSecret: async () => undefined,
  }),
}));

vi.mock('imapflow', () => ({
  ImapFlow: class ImapFlow {
    constructor(public options: any) {
      imapFlowMock.instances.push(this);
    }
    async connect() {
      if (imapFlowMock.connectShouldFail) {
        const failure: any = new Error('Authentication failed');
        failure.authenticationFailed = true;
        throw failure;
      }
    }
    async logout() {}
    close() {}
  },
}));

// Google transport surface of configureGmailProvider: Pub/Sub provisioning
// and the Gmail watch registration are stubbed so the REAL orchestrator
// (and its DB pause-state decisions) runs against the test database.
vi.mock('@alga-psa/integrations/actions/email-actions/setupPubSub', () => ({
  setupPubSub: async (params: any) => {
    pubsubMock.calls.push(params);
  },
}));

vi.mock('@alga-psa/integrations/services/email/GmailWebhookService', () => ({
  GmailWebhookService: class GmailWebhookService {
    constructor() {
      gmailWatchMock.instances.push(this);
    }
    async registerWatch() {
      // Mirrors the real service, which reports failure by return value.
      if (gmailWatchMock.registerShouldFail) {
        return { success: false, error: 'Gmail watch registration failed: invalid grant' };
      }
      return { success: true, historyId: '5001', expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
    }
  },
}));

// GmailAdapter backs the lifecycle recovery's credential validation, watch
// re-establishment, and paused-interval reconciliation.
vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    constructor(public config: any) {
      gmailAdapterMock.instances.push(this);
    }
    async testConnection() {
      return gmailAdapterMock.testConnectionShouldFail
        ? { success: false, error: 'Invalid Credentials' }
        : { success: true };
    }
    async registerWebhookSubscription() {
      return { success: true };
    }
    async listMessagesSince(historyId: any) {
      gmailAdapterMock.listMessagesSinceCalls.push(historyId);
      return [];
    }
    async listMessageIdsSinceTime() {
      return [];
    }
  },
}));

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'auth-pause reconnect save test fixture creates and removes tenant rows'
  );
}

type PauseState = 'auth_failure' | 'manual' | null;

async function seedImapProvider(pause: PauseState): Promise<string> {
  const providerId = uuidv4();
  const pausedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'imap',
    provider_name: 'Support IMAP (paused)',
    mailbox: `reconnect-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: pause ? 'error' : 'connected',
    error_message: pause
      ? 'Sign-in was rejected by the email provider. Reconnect the mailbox to resume inbound email.'
      : null,
    inbound_paused_at: pause ? pausedAt : null,
    inbound_pause_reason: pause,
    inbound_auth_failure_count: pause === 'auth_failure' ? 3 : 0,
    inbound_auth_failure_last_at: pause === 'auth_failure' ? pausedAt : null,
    inbound_auth_failure_code: pause === 'auth_failure' ? 'imap:AUTHENTICATIONFAILED' : null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('imap_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    host: 'imap.example.com',
    port: 993,
    secure: true,
    allow_starttls: false,
    auth_type: 'password',
    username: `reconnect-${providerId.slice(0, 8)}`,
    folder_filters: JSON.stringify(['INBOX']),
    auto_process_emails: true,
    max_emails_per_sync: 50,
    uid_validity: 'abc',
    last_uid: '400',
    folder_state: JSON.stringify({ INBOX: { uid_validity: 'abc', last_uid: '400' } }),
    last_error: pause ? 'AUTHENTICATIONFAILED (paused-interval state)' : null,
    created_at: now,
    updated_at: now,
  });
  // The stored credential the pause was earned with (dead), so a recovery
  // that ignores the submitted password is distinguishable from one that
  // validates the just-saved credential.
  secretsMock.store.set(`${testTenant}:imap_password_${providerId}`, 'old-dead-password');
  return providerId;
}

// Mirrors ImapProviderForm's onSubmit payload (packages/integrations and the
// EE copies), including the skipAutomation=true third argument used at the
// call site — that exact combination is the Reconnect drawer's save.
function formImapPayload(providerId: string) {
  return {
    tenant: testTenant,
    providerType: 'imap',
    providerName: 'Support IMAP (reconnected)',
    senderDisplayName: null as const,
    mailbox: `reconnect-${providerId.slice(0, 8)}@example.com`,
    isActive: true,
    imapConfig: {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      allow_starttls: false,
      auth_type: 'password',
      username: `reconnect-${providerId.slice(0, 8)}`,
      password: 'new-valid-password',
      auto_process_emails: true,
      folder_filters: ['INBOX'],
      max_emails_per_sync: 5,
      connection_timeout_ms: 10_000,
      socket_keepalive: true,
    },
  };
}

async function getProviderRow(providerId: string) {
  return tenantTable('email_providers').where({ id: providerId }).first();
}

async function getImapConfigRow(providerId: string) {
  return tenantTable('imap_email_provider_config')
    .where({ email_provider_id: providerId })
    .first('uid_validity', 'last_uid', 'folder_state', 'last_error');
}

async function seedGoogleProvider(pause: PauseState, options?: { tokens?: boolean }): Promise<string> {
  const providerId = uuidv4();
  const pausedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const now = new Date();
  const withTokens = options?.tokens !== false;
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'google',
    provider_name: 'Support Gmail (paused)',
    mailbox: `gmail-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: pause ? 'error' : 'connected',
    error_message: pause
      ? 'Sign-in was rejected by the email provider. Reconnect the mailbox to resume inbound email.'
      : null,
    inbound_paused_at: pause ? pausedAt : null,
    inbound_pause_reason: pause,
    inbound_auth_failure_count: pause === 'auth_failure' ? 3 : 0,
    inbound_auth_failure_last_at: pause === 'auth_failure' ? pausedAt : null,
    inbound_auth_failure_code: pause === 'auth_failure' ? 'google:INVALID_CREDENTIALS' : null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('google_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: null,
    client_secret: null,
    project_id: 'test-project',
    redirect_uri: 'http://localhost:3000/api/auth/google/callback',
    pubsub_topic_name: `gmail-notifications-${testTenant}`,
    pubsub_subscription_name: `gmail-webhook-${testTenant}`,
    auto_process_emails: true,
    max_emails_per_sync: 50,
    label_filters: JSON.stringify(['INBOX']),
    // Tokens are only stale placeholders — every Google transport call is
    // mocked — but their presence/absence steers configureGmailProvider's
    // watch-registration guard, which is under test.
    access_token: withTokens ? 'stale-access-token' : null,
    refresh_token: withTokens ? 'stale-refresh-token' : null,
    history_id: '5000',
    created_at: now,
    updated_at: now,
  });
  // Tenant-level Google OAuth settings persistGoogleConfig requires (the
  // forms send client_id/client_secret: null and rely on these secrets).
  secretsMock.store.set(`${testTenant}:google_client_id`, 'test-client-id');
  secretsMock.store.set(`${testTenant}:google_client_secret`, 'test-client-secret');
  secretsMock.store.set(`${testTenant}:google_project_id`, 'test-project');
  return providerId;
}

// Mirrors GmailProviderForm's onSubmit payload (packages/integrations and
// the EE copy), including the skipAutomation argument used at the call
// site. Without `withFreshTokens` the payload carries no OAuth tokens —
// the "user saved without re-authorizing" shape.
function formGooglePayload(providerId: string, withFreshTokens = true) {
  return {
    tenant: testTenant,
    providerType: 'google',
    providerName: 'Support Gmail (reconnected)',
    senderDisplayName: null as const,
    mailbox: `gmail-${providerId.slice(0, 8)}@example.com`,
    isActive: true,
    googleConfig: {
      client_id: null,
      client_secret: null,
      auto_process_emails: true,
      label_filters: ['INBOX'],
      max_emails_per_sync: 50,
      ...(withFreshTokens && {
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
      }),
    },
  };
}

describeDb('auth-pause reconnect save path (updateEmailProvider, DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    // Gmail setup refuses to provision against an address Google cannot push
    // to, so the suite has to look like a publicly reachable instance.
    delete process.env.NGROK_URL;
    process.env.NEXT_PUBLIC_BASE_URL = 'https://reconnect-save.example.com';
    // Scratch database instead of the shared test_database: every
    // DB-backed suite bootstrap DROPs its database, and parallel worktree
    // agents sharing the local test Postgres repeatedly dropped
    // test_database mid-suite here, killing this run's migrations. All
    // app-layer DB access in this suite is mocked to the returned handle,
    // so a private name isolates the bootstrap without changing behavior.
    testDb = await createTestDbConnection({
      databaseName: 'test_database_auth_pause_reconnect',
    });
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Reconnect Save Test Client',
      email: 'reconnect-save@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('email_providers').delete();
      await tenantTable('imap_email_provider_config').delete();
      await tenantTable('google_email_provider_config').delete();
      await tenantFixtureTable().where({ tenant: testTenant }).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(() => {
    imapFlowMock.instances.length = 0;
    imapFlowMock.connectShouldFail = false;
    secretsMock.store.clear();
    pubsubMock.calls.length = 0;
    gmailWatchMock.instances.length = 0;
    gmailWatchMock.registerShouldFail = false;
    gmailAdapterMock.instances.length = 0;
    gmailAdapterMock.testConnectionShouldFail = false;
    gmailAdapterMock.listMessagesSinceCalls.length = 0;
  });

  it('the Reconnect drawer save (skipAutomation=true) recovers an auth-paused IMAP provider end-to-end', async () => {
    const providerId = await seedImapProvider('auth_failure');

    // Pre-fix failure signal: with the recovery branch gated on
    // !skipAutomation, this save reported success while every pause column,
    // the auth-failure counter, and the stale IMAP cursors survived — the
    // provider stayed dead after a "successful" reconnect.
    const result = await updateEmailProvider(providerId, formImapPayload(providerId), true);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeUndefined();
    expect(result.provider).toBeDefined();

    // Credential validation ran against the SOURCE with the just-saved
    // password (not the stored dead one), exactly once.
    expect(imapFlowMock.instances).toHaveLength(1);
    expect(imapFlowMock.instances[0].options.auth.pass).toBe('new-valid-password');

    // Pause cleared and counters reset: ingestion (discovery/poller gating)
    // resumes.
    const row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
    expect(row.inbound_pause_reason).toBeNull();
    expect(Number(row.inbound_auth_failure_count)).toBe(0);
    expect(row.inbound_auth_failure_last_at).toBeNull();
    expect(row.inbound_auth_failure_code).toBeNull();
    expect(row.status).toBe('connected');
    expect(row.error_message).toBeNull();

    // The RETURNED provider must mirror that post-recovery row, not the
    // pre-recovery snapshot assembled before recovery ran: the settings
    // banner renders from this object, so a stale pause/status here keeps
    // the "reconnect required" banner on screen after a successful
    // reconnect until a manual refresh.
    expect(result.provider.inboundPausedAt).toBeNull();
    expect(result.provider.inboundPauseReason).toBeNull();
    expect(Number(result.provider.inboundAuthFailureCount)).toBe(0);
    expect(result.provider.inboundAuthFailureLastAt).toBeNull();
    expect(result.provider.inboundAuthFailureCode).toBeNull();
    expect(result.provider.status).toBe('connected');
    expect(result.provider.errorMessage).toBeNull();

    // Pause-window backfill armed: UID/folder cursors reset so the poller
    // rescans the paused interval (last_uid '0' = scan from UID 1).
    const config = await getImapConfigRow(providerId);
    expect(config.uid_validity).toBeNull();
    expect(config.last_uid).toBe('0');
    expect(config.folder_state).toEqual({});
    expect(config.last_error).toBeNull();
  });

  it('invalid credentials: the same save leaves the pause, counter, and cursors intact and surfaces the error', async () => {
    const providerId = await seedImapProvider('auth_failure');
    imapFlowMock.connectShouldFail = true;

    // Pre-fix failure signal: no recovery ran at all, so the save reported
    // success with no error while the provider stayed paused. Post-fix the
    // failed source validation must refuse the recovery.
    const result = await updateEmailProvider(providerId, formImapPayload(providerId), true);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeTruthy();
    expect((result as any).provider.status).toBe('error');

    // The returned provider must show the still-paused state (post-recovery
    // re-read), so the settings banner persists alongside the form error.
    expect(result.provider.inboundPausedAt).not.toBeNull();
    expect(result.provider.inboundPauseReason).toBe('auth_failure');

    expect(imapFlowMock.instances).toHaveLength(1);

    const row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(Number(row.inbound_auth_failure_count)).toBe(3);
    expect(row.inbound_auth_failure_code).toBe('imap:AUTHENTICATIONFAILED');

    // Cursors survive: they are only cleared AFTER validation succeeds.
    const config = await getImapConfigRow(providerId);
    expect(config.uid_validity).toBe('abc');
    expect(config.last_uid).toBe('400');
  });

  it('unrelated edit on a healthy provider: no recovery, no credential validation, cursors preserved', async () => {
    const providerId = await seedImapProvider(null);

    const result = await updateEmailProvider(providerId, formImapPayload(providerId), true);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeUndefined();

    // No ImapFlow instance: the recovery's validate-against-source never ran.
    expect(imapFlowMock.instances).toHaveLength(0);

    const row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
    expect(row.inbound_pause_reason).toBeNull();

    const config = await getImapConfigRow(providerId);
    expect(config.uid_validity).toBe('abc');
    expect(config.last_uid).toBe('400');
  });

  it('unrelated edit on a manually-paused provider: the manual pause is not lifted', async () => {
    const providerId = await seedImapProvider('manual');

    const result = await updateEmailProvider(providerId, formImapPayload(providerId), true);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeUndefined();
    expect(imapFlowMock.instances).toHaveLength(0);

    const row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('manual');

    const config = await getImapConfigRow(providerId);
    expect(config.last_uid).toBe('400');
  });

  it('Google: a watch registration failure (revoked credentials) on an auth-paused provider is a recovery failure, not success', async () => {
    const providerId = await seedGoogleProvider('auth_failure');
    gmailWatchMock.registerShouldFail = true;

    // Pre-fix failure signal: the watch-throw catch converted the failure
    // into `success = pubsubConfigured` with no authFailureRecovery, so the
    // save returned a clean success — provider "connected", no setupError —
    // while every pause column survived. The mailbox stayed dark with the
    // UI reporting everything fine.
    const result = await updateEmailProvider(providerId, formGooglePayload(providerId), false);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeTruthy();
    expect(result.provider.status).toBe('error');
    // The returned provider shows the still-paused state (post-recovery
    // re-read), so the banner persists alongside the form error.
    expect(result.provider.inboundPausedAt).not.toBeNull();
    expect(result.provider.inboundPauseReason).toBe('auth_failure');

    expect(gmailWatchMock.instances).toHaveLength(1);

    const row = await getProviderRow(providerId);
    expect(row.status).not.toBe('connected');
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(Number(row.inbound_auth_failure_count)).toBe(3);
    expect(row.inbound_auth_failure_code).toBe('google:INVALID_CREDENTIALS');
  });

  it('Google: missing OAuth tokens on an auth-paused provider fail the reconnect instead of warning-tolerated success', async () => {
    // Stored tokens were cleared (revoked) and the save carries no fresh
    // OAuth tokens — the reconnect cannot re-establish the watch at all.
    const providerId = await seedGoogleProvider('auth_failure', { tokens: false });

    // Pre-fix failure signal: the missing-tokens early return reported
    // `success = pubsubConfigured` (true) with authFailureRecovery unset —
    // another clean success over a still-paused mailbox.
    const result = await updateEmailProvider(providerId, formGooglePayload(providerId, false), false);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeTruthy();
    expect(result.provider.status).toBe('error');
    expect(result.provider.inboundPausedAt).not.toBeNull();
    expect(result.provider.inboundPauseReason).toBe('auth_failure');

    // The watch guard fired before any registration attempt.
    expect(gmailWatchMock.instances).toHaveLength(0);

    const row = await getProviderRow(providerId);
    expect(row.status).not.toBe('connected');
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(Number(row.inbound_auth_failure_count)).toBe(3);
  });

  it('Google: a skipAutomation save of an auth-paused provider never returns silent success', async () => {
    const providerId = await seedGoogleProvider('auth_failure');
    // Recovery must validate the stored credentials itself (no transport
    // ran to prove them); the source rejects them.
    gmailAdapterMock.testConnectionShouldFail = true;

    // Pre-fix failure signal: the Google branch was gated on
    // !skipAutomation, so no recovery was attempted and the save returned
    // a clean success while the provider stayed paused.
    const result = await updateEmailProvider(providerId, formGooglePayload(providerId), true);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeTruthy();
    expect(result.provider.status).toBe('error');
    expect(result.provider.inboundPausedAt).not.toBeNull();
    expect(result.provider.inboundPauseReason).toBe('auth_failure');

    // skipAutomation still means no transport automation: Pub/Sub setup and
    // watch registration never ran; only lifecycle recovery (credential
    // validation) did.
    expect(pubsubMock.calls).toHaveLength(0);
    expect(gmailWatchMock.instances).toHaveLength(0);
    expect(gmailAdapterMock.instances).toHaveLength(1);

    const row = await getProviderRow(providerId);
    expect(row.status).not.toBe('connected');
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(Number(row.inbound_auth_failure_count)).toBe(3);
  });

  it('Google: a successful reconnect (watch re-registered) resumes the paused provider end-to-end', async () => {
    const providerId = await seedGoogleProvider('auth_failure');

    const result = await updateEmailProvider(providerId, formGooglePayload(providerId), false);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeUndefined();

    // The watch was re-registered (fresh OAuth tokens saved), and the
    // paused interval was reconciled from the pre-watch history cursor.
    expect(gmailWatchMock.instances).toHaveLength(1);
    expect(gmailAdapterMock.listMessagesSinceCalls).toEqual(['5000']);

    const row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
    expect(row.inbound_pause_reason).toBeNull();
    expect(Number(row.inbound_auth_failure_count)).toBe(0);
    expect(row.inbound_auth_failure_last_at).toBeNull();
    expect(row.inbound_auth_failure_code).toBeNull();
    expect(row.status).toBe('connected');
    expect(row.error_message).toBeNull();

    // The returned provider mirrors the post-recovery row, not the
    // pre-recovery snapshot (the settings banner renders from it).
    expect(result.provider.inboundPausedAt).toBeNull();
    expect(result.provider.inboundPauseReason).toBeNull();
    expect(Number(result.provider.inboundAuthFailureCount)).toBe(0);
    expect(result.provider.status).toBe('connected');
  });

  it('Google: a watch failure on a healthy provider is a failed save, not a warning under a green status', async () => {
    // The pause machinery is not involved here — this is the plain case of an
    // administrator saving a Gmail provider whose watch cannot be registered.
    // Pub/Sub provisioning succeeding on its own delivers no mail, so the save
    // must not report the provider connected.
    const providerId = await seedGoogleProvider(null);
    gmailWatchMock.registerShouldFail = true;

    const result = await updateEmailProvider(providerId, formGooglePayload(providerId), false);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeTruthy();
    // The underlying Google failure reaches the administrator verbatim.
    expect((result as any).setupError).toContain('invalid grant');
    expect(result.provider.status).toBe('error');

    const row = await getProviderRow(providerId);
    expect(row.status).not.toBe('connected');
  });

  it('Google: a save without OAuth tokens on a healthy provider reports failure rather than partial success', async () => {
    const providerId = await seedGoogleProvider(null, { tokens: false });

    const result = await updateEmailProvider(providerId, formGooglePayload(providerId, false), false);

    expect((result as any).actionError).toBeUndefined();
    expect((result as any).setupError).toBeTruthy();
    expect(result.provider.status).toBe('error');
    // The watch guard fired before any registration attempt.
    expect(gmailWatchMock.instances).toHaveLength(0);
  });

  it('Google: a second save re-verifies instead of trusting a recent pubsub_initialised_at', async () => {
    const providerId = await seedGoogleProvider(null);

    const first = await updateEmailProvider(providerId, formGooglePayload(providerId), false);
    expect((first as any).setupError).toBeUndefined();
    expect(pubsubMock.calls).toHaveLength(1);
    expect(gmailWatchMock.instances).toHaveLength(1);

    // The old 24-hour cool-down returned pubsubConfigured/watchRegistered=true
    // here without calling anything; a broken provider stayed green until the
    // window lapsed.
    gmailWatchMock.registerShouldFail = true;
    const second = await updateEmailProvider(providerId, formGooglePayload(providerId), false);

    expect(pubsubMock.calls).toHaveLength(2);
    expect(gmailWatchMock.instances).toHaveLength(2);
    expect((second as any).setupError).toBeTruthy();
    expect(second.provider.status).toBe('error');
  });

  it('Google: the push endpoint and OIDC audience come from the configured public base URL', async () => {
    const providerId = await seedGoogleProvider(null);

    await updateEmailProvider(providerId, formGooglePayload(providerId), false);

    expect(pubsubMock.calls).toHaveLength(1);
    expect(pubsubMock.calls[0]).toMatchObject({
      topicName: `gmail-notifications-${testTenant}`,
      subscriptionName: `gmail-webhook-${testTenant}`,
      webhookUrl: 'https://reconnect-save.example.com/api/email/webhooks/google',
    });
  });

  it('Google: setup refuses to provision against an address Google cannot push to', async () => {
    const providerId = await seedGoogleProvider(null);
    const saved = process.env.NEXT_PUBLIC_BASE_URL;
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';

    try {
      const result = await updateEmailProvider(providerId, formGooglePayload(providerId), false);

      expect((result as any).setupError).toMatch(/publicly reachable HTTPS endpoint/);
      expect(result.provider.status).toBe('error');
      expect(pubsubMock.calls).toHaveLength(0);
    } finally {
      process.env.NEXT_PUBLIC_BASE_URL = saved;
    }
  });
});
