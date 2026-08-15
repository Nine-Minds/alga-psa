/**
 * Behavioral integration tests for the inbound auth-failure auto-pause:
 *
 * - two classified failures keep the provider active; the third atomically
 *   pauses it with reason `auth_failure`, tears down the external
 *   subscription exactly once, and dispatches the admin notification
 *   exactly once — including under concurrent failing jobs;
 * - `recordSourceAccessSuccess` resets the counter;
 * - the server-side admin notifier creates exactly one `system-announcement`
 *   internal notification per active admin (never for non-admins).
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { EmailProviderLifecycleService } from '@alga-psa/shared/services/email/EmailProviderLifecycleService';
import { INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD } from '@alga-psa/shared/services/email/InboundEmailAuthFailurePolicy';
import {
  clearInboundAuthPauseNotifier,
  registerInboundAuthPauseNotifier,
  type InboundAuthPauseNotificationParams,
} from '@alga-psa/shared/services/email/inboundAuthPauseNotifier';

const describeDb = await describeWithDb();

let testDb: Knex;
let testTenant: string;

const stopWatchCalls: any[] = [];
const dispatchedNotifications: InboundAuthPauseNotificationParams[] = [];

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: class GmailAdapter {
    constructor(public config: any) {}
    async stopWatch() {
      stopWatchCalls.push(this.config?.id);
    }
    async registerWebhookSubscription() {}
    async connect() {}
    async testConnection() {
      return { success: true };
    }
    async listMessagesSince() {
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
    'inbound auth-failure auto-pause test fixture creates and removes tenant rows'
  );
}

async function seedGoogleProvider(): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'google',
    provider_name: 'Paused Mailbox',
    mailbox: `pause-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'connected',
    inbound_paused_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('google_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: 'client-id',
    client_secret: 'client-secret',
    project_id: 'project',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    label_filters: JSON.stringify([]),
    access_token: 'access',
    refresh_token: 'refresh',
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    history_id: '1000',
    watch_expiration: new Date(Date.now() + 3600_000).toISOString(),
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

async function seedUserWithRole(roleName: 'admin' | 'owner' | 'member'): Promise<string> {
  const userId = uuidv4();
  await tenantTable('users').insert({
    tenant: testTenant,
    user_id: userId,
    username: `user-${userId.slice(0, 8)}`,
    hashed_password: 'unused',
    user_type: 'internal',
    email: `user-${userId.slice(0, 8)}@test.co`,
    created_at: new Date(),
    updated_at: new Date(),
  });
  if (roleName !== 'member') {
    const roleId = uuidv4();
    await tenantTable('roles').insert({
      tenant: testTenant,
      role_id: roleId,
      role_name: roleName,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await tenantTable('user_roles').insert({
      tenant: testTenant,
      user_id: userId,
      role_id: roleId,
    });
  }
  return userId;
}

async function getProviderRow(providerId: string) {
  return tenantTable('email_providers').where({ id: providerId }).first();
}

describeDb('inbound auth-failure auto-pause lifecycle (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Auth Pause Test Client',
      email: 'auth-pause@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('internal_notifications').delete();
      await tenantTable('user_roles').delete();
      await tenantTable('roles').delete();
      await tenantTable('users').delete();
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  beforeEach(() => {
    stopWatchCalls.length = 0;
    dispatchedNotifications.length = 0;
    registerInboundAuthPauseNotifier(async (params) => {
      dispatchedNotifications.push(params);
    });
  });

  afterEach(() => {
    clearInboundAuthPauseNotifier();
  });

  it('exposes the fixed threshold of three', () => {
    expect(INBOUND_AUTH_FAILURE_PAUSE_THRESHOLD).toBe(3);
  });

  it('keeps the provider active after two failures and pauses atomically on the third', async () => {
    const providerId = await seedGoogleProvider();
    const service = new EmailProviderLifecycleService();

    const first = await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(first.autoPaused).toBe(false);
    expect(first.count).toBe(1);

    let row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
    expect(Number(row.inbound_auth_failure_count)).toBe(1);
    expect(row.inbound_auth_failure_code).toBe('google:invalid_grant');
    expect(row.status).toBe('connected');

    const second = await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(second.autoPaused).toBe(false);
    expect(second.count).toBe(2);
    row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();

    const third = await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(third.autoPaused).toBe(true);
    expect(third.count).toBe(3);

    row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(Number(row.inbound_auth_failure_count)).toBe(3);
    expect(row.inbound_auth_failure_code).toBe('google:invalid_grant');
    expect(row.inbound_auth_failure_last_at).not.toBeNull();
    expect(row.status).toBe('error');
    expect(row.error_message).not.toContain('invalid_grant');

    // Exactly one teardown and one notification dispatch for the pause.
    expect(stopWatchCalls).toEqual([providerId]);
    expect(dispatchedNotifications).toHaveLength(1);
    expect(dispatchedNotifications[0]).toMatchObject({
      tenant: testTenant,
      providerId,
      providerName: 'Paused Mailbox',
      authFailureCode: 'google:invalid_grant',
    });
  });

  it('pauses exactly once under concurrent failing jobs (no double teardown or notification)', async () => {
    const providerId = await seedGoogleProvider();
    const service = new EmailProviderLifecycleService();

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant')
      )
    );

    // Serialized by the row lock: the transaction observing the
    // unpaused→paused transition is the only one that tears down/notifies.
    expect(outcomes.filter((outcome) => outcome.autoPaused)).toHaveLength(1);

    const row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    // Once paused, later failures no-op instead of inflating the counter.
    expect(Number(row.inbound_auth_failure_count)).toBe(3);

    expect(stopWatchCalls).toEqual([providerId]);
    expect(dispatchedNotifications).toHaveLength(1);
  });

  it('resets the counter on successful source access (including no new messages)', async () => {
    const providerId = await seedGoogleProvider();
    const service = new EmailProviderLifecycleService();

    await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');

    await service.recordSourceAccessSuccess(providerId, testTenant);

    let row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
    expect(Number(row.inbound_auth_failure_count)).toBe(0);
    expect(row.inbound_auth_failure_last_at).toBeNull();
    expect(row.inbound_auth_failure_code).toBeNull();

    // The next failure starts a fresh consecutive run: two more are needed.
    const afterReset = await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(afterReset.autoPaused).toBe(false);
    expect(afterReset.count).toBe(1);
    row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
  });

  it('resets stale auth-failure counters on manual resume so one later failure does not auto-pause', async () => {
    const providerId = await seedGoogleProvider();
    const service = new EmailProviderLifecycleService();

    // Arm the counter to 2, then pause/resume manually (e.g. an operator
    // pause during maintenance).
    await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(await service.pauseProvider(providerId, testTenant, 'manual')).toBe(true);

    const resumed = await service.resumeProvider(providerId, testTenant);
    expect(resumed.resumed).toBe(true);

    let row = await getProviderRow(providerId);
    expect(Number(row.inbound_auth_failure_count)).toBe(0);
    expect(row.inbound_auth_failure_last_at).toBeNull();
    expect(row.inbound_auth_failure_code).toBeNull();

    // A single later classified failure must NOT auto-pause anymore.
    const outcome = await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(outcome.autoPaused).toBe(false);
    row = await getProviderRow(providerId);
    expect(row.inbound_paused_at).toBeNull();
  });

  it('keeps manual pause semantics: recordUnrecoverableAuthFailure no-ops on an already-paused provider', async () => {
    const providerId = await seedGoogleProvider();
    const service = new EmailProviderLifecycleService();

    const paused = await service.pauseProvider(providerId, testTenant, 'manual');
    expect(paused).toBe(true);

    const outcome = await service.recordUnrecoverableAuthFailure(providerId, testTenant, 'google:invalid_grant');
    expect(outcome.autoPaused).toBe(false);

    const row = await getProviderRow(providerId);
    expect(row.inbound_pause_reason).toBe('manual');
    expect(Number(row.inbound_auth_failure_count)).toBe(0);
    expect(stopWatchCalls).toEqual([providerId]); // manual pause tore down; the no-op added nothing
    expect(dispatchedNotifications).toHaveLength(0);
  });

  it('creates one system-announcement notification per active admin (never for members)', async () => {
    const { notifyInboundAuthPauseAdmins } = await import(
      '../../services/email/inboundAuthPauseNotificationService'
    );

    await seedUserWithRole('admin');
    await seedUserWithRole('admin');
    await seedUserWithRole('owner');
    await seedUserWithRole('member');

    const admins = await tenantTable('user_roles')
      .join('roles', 'roles.role_id', 'user_roles.role_id')
      .whereRaw("LOWER(roles.role_name) IN ('admin', 'owner')")
      .count('user_roles.user_id as count');
    const expectedAdminCount = Number((admins[0] as any).count);

    await notifyInboundAuthPauseAdmins({
      tenant: testTenant,
      providerId: 'provider-notif-test',
      providerName: 'Notif Mailbox',
      mailbox: 'notif@example.com',
      providerType: 'microsoft',
      authFailureCode: 'microsoft:invalid_grant',
      pausedAt: new Date().toISOString(),
    });

    const notifications = await tenantTable('internal_notifications')
      .where({ template_name: 'system-announcement' })
      .select('user_id', 'link', 'title', 'message');

    expect(notifications).toHaveLength(expectedAdminCount);
    for (const notification of notifications) {
      expect(notification.link).toBe('/msp/settings?tab=email');
      // 'system-announcement' renders its message from {{announcementTitle}}.
      expect(notification.message).toContain('Notif Mailbox');
      expect(notification.message).toContain('notif@example.com');
      // No credential material may leak into the notification payload.
      expect(notification.message).not.toMatch(/refresh|token|secret/i);
    }
  });
});
