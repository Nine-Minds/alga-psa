/**
 * Behavioral integration tests for Microsoft token-health auth outcomes in
 * EmailWebhookMaintenanceService (covers providers whose subscription has
 * gone quiet and therefore no longer receive pointer jobs):
 *
 * - repeated terminal `invalid_client` token-health failures advance the same
 *   provider counter used by the queue processor (and pause at the threshold);
 * - a successful token-health check resets the counter.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';

const describeDb = await describeWithDb();

let testDb: Knex;
let testTenant: string;

const tokenHealthMock = vi.hoisted(() => ({
  ensureTokenHealthy: vi.fn(),
  listMessagesReceivedSince: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: () => {
    throw new Error('redis unavailable in maintenance auth-failure tests');
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => testDb,
}));

vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/services/email/microsoftEmailProviderConfig')>();
  return {
    ...actual,
    buildMicrosoftEmailProviderConfig: async (config: any) => config,
  };
});

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphError: class MicrosoftGraphError extends Error {},
  MicrosoftGraphAdapter: class MicrosoftGraphAdapter {
    constructor(public config: any) {}
    async ensureTokenHealthy() {
      return tokenHealthMock.ensureTokenHealthy();
    }
    async listMessagesReceivedSince() {
      return tokenHealthMock.listMessagesReceivedSince();
    }
  },
}));

function tenantTable<Row = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'maintenance auth-failure test fixture creates and removes tenant rows'
  );
}

async function seedPollingProvider(): Promise<string> {
  const providerId = uuidv4();
  const now = new Date();
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: testTenant,
    provider_type: 'microsoft',
    provider_name: 'Quiet Mailbox',
    mailbox: `quiet-${providerId.slice(0, 8)}@example.com`,
    is_active: true,
    status: 'connected',
    inbound_paused_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await tenantTable('microsoft_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: testTenant,
    client_id: 'client-id',
    client_secret: 'client-secret',
    tenant_id: 'directory-tenant-guid',
    redirect_uri: 'https://psa.example.com/api/auth/microsoft/callback',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: 'stale',
    refresh_token: 'revoked',
    token_expires_at: new Date(Date.now() - 3600_000).toISOString(),
    delivery_mode: 'polling',
    created_at: now,
    updated_at: now,
  });
  return providerId;
}

async function getCount(providerId: string): Promise<number> {
  const row = await tenantTable('email_providers').where({ id: providerId }).first('inbound_auth_failure_count');
  return Number(row?.inbound_auth_failure_count || 0);
}

function sanitizedInvalidClientError(): Error {
  const failure: any = new Error('Error in refreshAccessToken: Request failed with status code 401 (code: 401)');
  failure.status = 401;
  failure.code = '401';
  failure.responseBody = { error: 'invalid_client', error_description: 'AADSTS7000215' };
  return failure;
}

describeDb('Microsoft maintenance token-health auth outcomes (DB-backed)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Maintenance Auth Test Client',
      email: 'maintenance-auth@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
  }, 180_000);

  afterAll(async () => {
    if (testTenant) {
      await tenantTable('email_provider_health').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    }
    await testDb?.destroy().catch(() => undefined);
  }, 30_000);

  it('uses the same counter for repeated token-health invalid_client failures and pauses at the threshold', async () => {
    const providerId = await seedPollingProvider();
    tokenHealthMock.ensureTokenHealthy.mockRejectedValue(sanitizedInvalidClientError());
    tokenHealthMock.listMessagesReceivedSince.mockResolvedValue([]);

    const service = new EmailWebhookMaintenanceService();

    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    expect(await getCount(providerId)).toBe(1);

    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    expect(await getCount(providerId)).toBe(2);

    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    expect(await getCount(providerId)).toBe(3);

    const row = await tenantTable('email_providers').where({ id: providerId }).first();
    expect(row.inbound_paused_at).not.toBeNull();
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(row.inbound_auth_failure_code).toBe('microsoft:invalid_client');
  });

  it('resets the counter after a successful token-health check', async () => {
    const providerId = await seedPollingProvider();
    tokenHealthMock.ensureTokenHealthy.mockRejectedValueOnce(sanitizedInvalidClientError());
    tokenHealthMock.ensureTokenHealthy.mockResolvedValue(undefined);
    tokenHealthMock.listMessagesReceivedSince.mockResolvedValue([]);

    const service = new EmailWebhookMaintenanceService();

    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    expect(await getCount(providerId)).toBe(1);

    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    expect(await getCount(providerId)).toBe(0);

    const row = await tenantTable('email_providers').where({ id: providerId }).first();
    expect(row.inbound_paused_at).toBeNull();
  });

  it('flags reconciliation as truncated when the requested boundary predates the 7-day window cap', async () => {
    const providerId = await seedPollingProvider();
    tokenHealthMock.ensureTokenHealthy.mockResolvedValue(undefined);
    tokenHealthMock.listMessagesReceivedSince.mockResolvedValue([]);

    // The module-level vi.mock only stubs the adapter; the service class
    // (and therefore the real reconciliation algorithm) runs against the DB.
    const result = await new EmailWebhookMaintenanceService().reconcileProviderMessages({
      providerId,
      tenant: testTenant,
      since: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
    });

    expect(result.truncated).toBe(true);

    // Within the cap: no truncation flag.
    const withinCap = await new EmailWebhookMaintenanceService().reconcileProviderMessages({
      providerId,
      tenant: testTenant,
      since: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
    });
    expect(withinCap.truncated).toBeFalsy();
  });

  it('keeps the curated auto-pause error message when the token-health catch path runs after the pause', async () => {
    const providerId = await seedPollingProvider();
    // First two calls pause the provider; the third verifies the catch path.
    tokenHealthMock.ensureTokenHealthy.mockRejectedValue(sanitizedInvalidClientError());
    tokenHealthMock.listMessagesReceivedSince.mockResolvedValue([]);

    const service = new EmailWebhookMaintenanceService();
    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });
    await service.reconcilePollingProviders({ tenantId: testTenant, providerId });

    const row = await tenantTable('email_providers')
      .where({ id: providerId })
      .first('inbound_paused_at', 'inbound_pause_reason', 'status', 'error_message');
    expect(row.inbound_pause_reason).toBe('auth_failure');
    expect(row.status).toBe('error');
    // The catch block's raw refresh-error text must NOT replace the curated
    // reconnect-required instruction written by the auto-pause transaction.
    expect(row.error_message).toBe(
      'Sign-in was rejected by the email provider. Reconnect the mailbox to resume inbound email.'
    );
  });

  it('does not count transient token-health failures', async () => {
    const providerId = await seedPollingProvider();
    const transient: any = new Error('timeout of 30000ms exceeded');
    transient.code = 'ECONNABORTED';
    tokenHealthMock.ensureTokenHealthy.mockRejectedValueOnce(transient);
    tokenHealthMock.listMessagesReceivedSince.mockResolvedValue([]);

    await new EmailWebhookMaintenanceService().reconcilePollingProviders({
      tenantId: testTenant,
      providerId,
    });

    expect(await getCount(providerId)).toBe(0);
    const row = await tenantTable('email_providers').where({ id: providerId }).first();
    expect(row.inbound_paused_at).toBeNull();
  });
});
