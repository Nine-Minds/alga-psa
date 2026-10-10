/**
 * Integration test for the cross-tenant inbound email health snapshot
 * (alga0002256). Seeds two tenants and asserts the expired / stale / paused
 * semantics (F3/F4) plus that no tenant or provider id leaks into the result.
 * Assertions are deltas against a baseline snapshot so a non-empty DB is fine.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import {
  collectInboundEmailHealthSnapshot,
  type InboundEmailHealthSnapshot,
} from '@alga-psa/shared/services/email/inboundEmailHealthSnapshot';

const describeDb = await describeWithDb();

let testDb: Knex;
const tenants: string[] = [];
const providerIds: string[] = [];

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

const HOUR = 3_600_000;

function table(tenant: string, name: string) {
  return tenantDb(testDb, tenant).table(name);
}

function fixtureTenants() {
  return tenantDb(testDb, 'health-snapshot-test').unscoped(
    'tenants',
    'health snapshot test fixture creates and removes tenant rows'
  );
}

interface SeedOptions {
  type: 'microsoft' | 'google' | 'imap';
  status?: string;
  active?: boolean;
  pausedAt?: Date | null;
  pauseReason?: string | null;
  authFailureCount?: number;
  authFailureCode?: string | null;
  lastSyncAt?: Date | null;
  createdAt?: Date;
  msc?: Record<string, unknown>;
  gmc?: Record<string, unknown>;
}

async function seed(tenant: string, o: SeedOptions): Promise<string> {
  const id = uuidv4();
  providerIds.push(id);
  const now = new Date();
  await table(tenant, 'email_providers').insert({
    id,
    tenant,
    provider_type: o.type,
    provider_name: `Health ${o.type}`,
    mailbox: `health-${id.slice(0, 8)}@example.com`,
    is_active: o.active ?? true,
    status: o.status ?? 'connected',
    inbound_paused_at: o.pausedAt ?? null,
    inbound_pause_reason: o.pauseReason ?? null,
    inbound_auth_failure_count: o.authFailureCount ?? 0,
    inbound_auth_failure_code: o.authFailureCode ?? null,
    last_sync_at: o.lastSyncAt ?? null,
    created_at: o.createdAt ?? now,
    updated_at: now,
  });

  if (o.type === 'microsoft') {
    await table(tenant, 'microsoft_email_provider_config').insert({
      email_provider_id: id,
      tenant,
      client_id: 'client-id',
      client_secret: 'client-secret',
      tenant_id: 'directory-guid',
      redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      folder_filters: JSON.stringify(['Inbox']),
      access_token: 'a',
      refresh_token: 'r',
      token_expires_at: new Date(Date.now() + HOUR).toISOString(),
      delivery_mode: 'webhook',
      webhook_silent_runs: 0,
      created_at: now,
      updated_at: now,
      ...o.msc,
    });
  } else if (o.type === 'google') {
    await table(tenant, 'google_email_provider_config').insert({
      email_provider_id: id,
      tenant,
      client_id: 'client-id',
      client_secret: 'client-secret',
      project_id: 'project',
      auto_process_emails: true,
      max_emails_per_sync: 50,
      label_filters: JSON.stringify([]),
      access_token: 'a',
      refresh_token: 'r',
      token_expires_at: new Date(Date.now() + HOUR).toISOString(),
      history_id: '1',
      created_at: now,
      updated_at: now,
      ...o.gmc,
    });
  } else {
    await table(tenant, 'imap_email_provider_config').insert({
      email_provider_id: id,
      tenant,
      host: 'imap.example.com',
      port: 993,
      secure: true,
      allow_starttls: false,
      auth_type: 'password',
      username: `u-${id.slice(0, 8)}`,
      folder_filters: JSON.stringify(['INBOX']),
      auto_process_emails: true,
      max_emails_per_sync: 50,
      created_at: now,
      updated_at: now,
    });
  }
  return id;
}

function sumProviders(s: InboundEmailHealthSnapshot, type: string, status?: string): number {
  return s.providers
    .filter((p) => p.providerType === type && (status === undefined || p.status === status))
    .reduce((a, p) => a + p.count, 0);
}

describeDb('inbound email health snapshot (integration)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
  }, 180_000);

  afterAll(async () => {
    for (const tenant of tenants) {
      await table(tenant, 'microsoft_email_provider_config').delete();
      await table(tenant, 'google_email_provider_config').delete();
      await table(tenant, 'imap_email_provider_config').delete();
      await table(tenant, 'email_providers').delete();
      await fixtureTenants().where({ tenant }).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  it('classifies expired, expiring, stale and paused providers without leaking ids', async () => {
    const now = new Date();
    const baseline = await collectInboundEmailHealthSnapshot({ knex: testDb, now, includeDurable: false });

    const tenantA = uuidv4();
    const tenantB = uuidv4();
    for (const tenant of [tenantA, tenantB]) {
      tenants.push(tenant);
      await fixtureTenants().insert({
        tenant,
        client_name: `Health ${tenant.slice(0, 6)}`,
        email: `health-${tenant.slice(0, 6)}@client.com`,
        created_at: now,
        updated_at: now,
      });
    }

    const recent = new Date(now.getTime() - 5 * 60_000);

    // Expired subscription on a provider in status=error: F4 says status is irrelevant.
    await seed(tenantA, {
      type: 'microsoft',
      status: 'error',
      lastSyncAt: recent,
      msc: {
        webhook_expires_at: new Date(now.getTime() - HOUR),
        webhook_silent_runs: 2,
        last_reconciliation_at: recent,
      },
    });
    // Expiring in 6h.
    await seed(tenantB, {
      type: 'microsoft',
      lastSyncAt: recent,
      msc: { webhook_expires_at: new Date(now.getTime() + 6 * HOUR), last_reconciliation_at: recent },
    });
    // Polling provider: must not appear in the subscription-state gauge.
    await seed(tenantB, {
      type: 'microsoft',
      lastSyncAt: recent,
      msc: { delivery_mode: 'polling', webhook_expires_at: new Date(now.getTime() - HOUR), last_reconciliation_at: recent },
    });
    // Gmail with an expired watch.
    await seed(tenantA, {
      type: 'google',
      lastSyncAt: recent,
      gmc: { watch_expiration: new Date(now.getTime() - HOUR), last_push_received_at: recent },
    });
    // IMAP stale (2h > 1h threshold).
    await seed(tenantB, { type: 'imap', lastSyncAt: new Date(now.getTime() - 2 * HOUR) });
    // Paused for auth failure.
    await seed(tenantA, {
      type: 'microsoft',
      status: 'error',
      pausedAt: new Date(now.getTime() - HOUR),
      pauseReason: 'auth_failure',
      authFailureCount: 3,
      authFailureCode: 'microsoft:invalid_client',
      msc: { webhook_expires_at: new Date(now.getTime() - HOUR) },
    });
    // Unpaused, one auth failure so far.
    await seed(tenantB, {
      type: 'google',
      authFailureCount: 1,
      authFailureCode: 'google:invalid_grant:some_subtype',
      lastSyncAt: recent,
      gmc: { watch_expiration: new Date(now.getTime() + 48 * HOUR), last_push_received_at: recent },
    });
    // Inactive provider: excluded from everything.
    await seed(tenantA, {
      type: 'imap',
      active: false,
      lastSyncAt: new Date(now.getTime() - 48 * HOUR),
    });

    const snap = await collectInboundEmailHealthSnapshot({ knex: testDb, now, includeDurable: false });

    // Active providers: deltas by type (inactive IMAP excluded).
    expect(sumProviders(snap, 'microsoft') - sumProviders(baseline, 'microsoft')).toBe(4);
    expect(sumProviders(snap, 'google') - sumProviders(baseline, 'google')).toBe(2);
    expect(sumProviders(snap, 'imap') - sumProviders(baseline, 'imap')).toBe(1);

    // Microsoft webhook subscriptions: expired (status=error one + the paused one are
    // excluded by the paused filter -> only the first), expiring 1, polling excluded.
    expect(snap.microsoft.subscriptions.expired - baseline.microsoft.subscriptions.expired).toBe(1);
    expect(snap.microsoft.subscriptions.expiring_lt_12h - baseline.microsoft.subscriptions.expiring_lt_12h).toBe(1);
    expect(snap.microsoft.deliveryMode.polling - baseline.microsoft.deliveryMode.polling).toBe(1);
    expect(snap.microsoft.silentWebhooks - baseline.microsoft.silentWebhooks).toBe(1);

    expect(snap.gmail.watches.expired - baseline.gmail.watches.expired).toBe(1);
    expect(snap.gmail.watches.healthy - baseline.gmail.watches.healthy).toBe(1);

    // Staleness: only the 2h-old IMAP provider (inactive one excluded).
    expect(snap.sync.stale.imap - baseline.sync.stale.imap).toBe(1);

    const pausedAuth = (s: InboundEmailHealthSnapshot) =>
      s.paused
        .filter((p) => p.providerType === 'microsoft' && p.reason === 'auth_failure' && p.code === 'microsoft:invalid_client')
        .reduce((a, p) => a + p.count, 0);
    expect(pausedAuth(snap) - pausedAuth(baseline)).toBe(1);

    const failingGoogle = (s: InboundEmailHealthSnapshot) =>
      s.authFailing
        .filter((p) => p.providerType === 'google' && p.code === 'google:invalid_grant')
        .reduce((a, p) => a + p.count, 0);
    expect(failingGoogle(snap) - failingGoogle(baseline)).toBe(1);

    const serialized = JSON.stringify(snap);
    for (const id of [...tenants, ...providerIds]) {
      expect(serialized).not.toContain(id);
    }
    expect(serialized).not.toMatch(/@example\.com/);
  }, 60_000);
});
