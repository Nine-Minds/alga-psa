/**
 * Callback relationship validation against real PostgreSQL.
 *
 * The /api/auth/microsoft/callback route verifies every relationship signed
 * into the OAuth state before touching credentials. It loads the referenced
 * `email_providers` row plus the persisted refresh-token flag exactly as shown
 * here and feeds them to `verifyMicrosoftEmailOAuthStateRelationships`. This
 * suite seeds real rows and reuses that same load path so each rejection code
 * is demonstrated against real provider state, not a hand-built object.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { verifyMicrosoftEmailOAuthStateRelationships } from '@alga-psa/integrations/lib/microsoftEmailStateGuard';
import { MICROSOFT_EMAIL_ISSUER_ERRORS } from '@alga-psa/integrations/lib/microsoftEmailIssuerSelection';
import type { MicrosoftEmailOAuthStatePayload } from '@alga-psa/integrations/utils/email/microsoftEmailOAuthState';

let testDb: Knex;
let testTenant: string;
let connectedProviderId: string;
const createdTenants: string[] = [];

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Microsoft email OAuth state relationship test fixture creates and removes tenant rows'
  );
}

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: testTenant })),
  };
});

/** Mirrors the provider context the callback loads before the relationship guard. */
async function loadStateProvider(providerId: string | null | undefined, tenantScope: string = testTenant) {
  if (!providerId) return null;
  const db = tenantDb(testDb, tenantScope);
  const providerRow = await db.table('email_providers')
    .where('id', providerId)
    .select('id', 'tenant', 'provider_type', 'status')
    .first();
  if (!providerRow) return null;
  const configRow = await db.table('microsoft_email_provider_config')
    .where('email_provider_id', providerId)
    .select('refresh_token')
    .first();
  return {
    id: providerRow.id,
    tenant: providerRow.tenant,
    provider_type: providerRow.provider_type,
    status: providerRow.status,
    refresh_token: configRow?.refresh_token ?? null,
  };
}

function signedPayload(overrides: Partial<MicrosoftEmailOAuthStatePayload> = {}): MicrosoftEmailOAuthStatePayload {
  return {
    purpose: 'reconnect',
    tenant: testTenant,
    userId: 'user-1',
    issuerKind: 'managed',
    clientId: 'managed-client',
    redirectUri: 'https://psa.example.com/api/auth/microsoft/callback',
    nonce: 'nonce-1',
    issuedAt: Math.floor(Date.now() / 1000) - 5,
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

function sessionUser(overrides: Record<string, unknown> = {}) {
  return { user_id: 'user-1', tenant: testTenant, ...overrides };
}

async function seedProvider(overrides: {
  tenant?: string;
  providerType?: string;
  refreshToken?: string | null;
} = {}) {
  const providerId = uuidv4();
  const now = new Date();
  const ownerTenant = overrides.tenant ?? testTenant;
  // `email_providers.tenant` is a FK into the tenants table; the provider (and
  // its config) must live in the tenant that owns it.
  await tenantFixtureTable()
    .insert({
      tenant: ownerTenant,
      client_name: 'Relationship Other Client',
      email: 'other@client.com',
      created_at: now,
      updated_at: now,
    })
    .onConflict('tenant')
    .ignore();
  if (!createdTenants.includes(ownerTenant)) createdTenants.push(ownerTenant);

  const ownerDb = ownerTenant === testTenant
    ? tenantTable
    : (table: string) => tenantDb(testDb, ownerTenant).table(table);

  await ownerDb('email_providers').insert({
    id: providerId,
    tenant: ownerTenant,
    provider_type: overrides.providerType ?? 'microsoft',
    provider_name: 'Relationship Mailbox',
    mailbox: `relationship-${uuidv4().slice(0, 8)}@client.com`,
    is_active: true,
    status: overrides.refreshToken ? 'connected' : 'configuring',
    error_message: null,
    created_at: now,
    updated_at: now,
  });
  await ownerDb('microsoft_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: ownerTenant,
    client_id: 'client-id',
    client_secret: 'client-secret',
    tenant_id: 'tenant-id',
    microsoft_profile_id: null,
    client_secret_ref: null,
    redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
    auto_process_emails: true,
    max_emails_per_sync: 50,
    folder_filters: JSON.stringify(['Inbox']),
    access_token: 'access',
    refresh_token: overrides.refreshToken === null ? null : (overrides.refreshToken ?? 'refresh-token'),
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    webhook_subscription_id: 'sub',
    webhook_verification_token: 'token',
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

describe('Microsoft email OAuth callback relationship validation (DB-backed)', () => {
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Relationship Test Client',
      email: 'relationship@client.com',
      created_at: new Date(),
      updated_at: new Date(),
    });
    connectedProviderId = await seedProvider();
  });

  afterAll(async () => {
    // Delete provider rows in every tenant created by this suite (the fixture
    // seeds cross-tenant providers), then the tenant rows themselves.
    for (const tenant of createdTenants) {
      const db = tenantDb(testDb, tenant);
      await db.table('microsoft_email_provider_config').delete();
      await db.table('email_providers').delete();
    }
    await tenantFixtureTable().whereIn('tenant', createdTenants).delete();
    await testDb.destroy();
  });

  it('accepts a reconnect state whose relationships all hold against real rows', async () => {
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: connectedProviderId }),
      sessionUser: sessionUser(),
      provider: await loadStateProvider(connectedProviderId),
    });
    expect(guard).toEqual({ ok: true });
  });

  it('rejects a state naming a provider that does not exist', async () => {
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: uuidv4() }),
      sessionUser: sessionUser(),
      provider: await loadStateProvider(uuidv4()),
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_NOT_FOUND });
  });

  it('rejects a state naming a provider that belongs to another tenant', async () => {
    const otherTenant = uuidv4();
    // The provider physically lives in the other tenant's schema, so the state
    // signed for our tenant cannot legally reference it.
    const crossTenantProviderId = await seedProvider({ tenant: otherTenant });
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: crossTenantProviderId }),
      sessionUser: sessionUser(),
      provider: await loadStateProvider(crossTenantProviderId, otherTenant),
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_TENANT_MISMATCH });
  });

  it('rejects a state naming a non-Microsoft provider', async () => {
    const googleProviderId = await seedProvider({ providerType: 'google' });
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: googleProviderId }),
      sessionUser: sessionUser(),
      provider: await loadStateProvider(googleProviderId),
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.PROVIDER_TYPE_NOT_SUPPORTED });
  });

  it('rejects a create state aimed at an already-connected provider', async () => {
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'create', providerId: connectedProviderId }),
      sessionUser: sessionUser(),
      provider: await loadStateProvider(connectedProviderId),
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_PURPOSE_MISMATCH });
  });

  it('rejects a reconnect state that does not name a provider', async () => {
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect' }),
      sessionUser: sessionUser(),
      provider: null,
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_PURPOSE_MISMATCH });
  });

  it('rejects when the session user differs from the user signed into the state', async () => {
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: connectedProviderId }),
      sessionUser: sessionUser({ user_id: 'attacker-user' }),
      provider: await loadStateProvider(connectedProviderId),
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.STATE_USER_MISMATCH });
  });

  it('rejects when the session tenant does not match the state tenant', async () => {
    const guard = verifyMicrosoftEmailOAuthStateRelationships({
      payload: signedPayload({ purpose: 'reconnect', providerId: connectedProviderId }),
      sessionUser: sessionUser({ tenant: 'some-other-workspace' }),
      provider: await loadStateProvider(connectedProviderId),
    });
    expect(guard).toMatchObject({ ok: false, code: MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_STATE });
  });

  it('rejects with a distinct code for each guarded failure mode', async () => {
    const otherTenant = uuidv4();
    const crossTenantProviderId = await seedProvider({ tenant: otherTenant });
    const googleProviderId = await seedProvider({ providerType: 'google' });
    const cases = [
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: uuidv4() }),
        sessionUser: sessionUser(),
        provider: null,
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: crossTenantProviderId }),
        sessionUser: sessionUser(),
        provider: await loadStateProvider(crossTenantProviderId, otherTenant),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: googleProviderId }),
        sessionUser: sessionUser(),
        provider: await loadStateProvider(googleProviderId),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'create', providerId: connectedProviderId }),
        sessionUser: sessionUser(),
        provider: await loadStateProvider(connectedProviderId),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: connectedProviderId }),
        sessionUser: sessionUser({ user_id: 'attacker-user' }),
        provider: await loadStateProvider(connectedProviderId),
      }),
      verifyMicrosoftEmailOAuthStateRelationships({
        payload: signedPayload({ purpose: 'reconnect', providerId: connectedProviderId }),
        sessionUser: sessionUser({ tenant: 'other-workspace' }),
        provider: await loadStateProvider(connectedProviderId),
      }),
    ].map((r) => (r.ok ? 'ok' : r.code));
    expect(new Set(cases).size).toBe(cases.length);
  });
});
