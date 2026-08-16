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

describeDb('auth-pause reconnect save path (updateEmailProvider, DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
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
      await tenantFixtureTable().where({ tenant: testTenant }).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(() => {
    imapFlowMock.instances.length = 0;
    imapFlowMock.connectShouldFail = false;
    secretsMock.store.clear();
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
});
