/**
 * Integration test for email provider creation functionality
 *
 * Exercises the live createEmailProvider/upsertEmailProvider action contract:
 * per-vendor snake_case config payloads (googleConfig/microsoftConfig), rows in
 * email_providers plus the per-vendor config tables, and Google OAuth client
 * credentials owned by tenant secrets rather than the database.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import process from 'node:process';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createEmailProvider } from '@alga-psa/integrations/actions/email-actions/emailProviderActions';

let testDb: Knex;
let testTenant: string;
let microsoftProfileId: string;
let microsoftProfileSecretRef: string;
let microsoftProfileSecretEnvKey: string;

const microsoftProfileClientId = 'profile-client-id';
const microsoftProfileClientSecret = 'profile-client-secret';
const microsoftProfileTenantId = 'profile-tenant-id';

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Email provider creation test fixture creates and removes tenant rows'
  );
}

// Route the action's tenant resolution (global withAuth mock) and any
// createTenantKnex callers at our test database/tenant.
vi.mock('../../lib/db', () => ({
  getCurrentTenantId: () => testTenant,
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

// The action gets its connection from @alga-psa/db; keep the real facade but
// point the connection at the test database.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: testDb, tenant: testTenant })),
  };
});

function googleConfig(overrides: Record<string, unknown> = {}) {
  return {
    client_id: 'test-client-id.apps.googleusercontent.com',
    client_secret: 'test-client-secret',
    project_id: 'test-project-id',
    redirect_uri: 'http://localhost:3000/api/auth/google/callback',
    label_filters: ['INBOX', 'UNREAD'],
    auto_process_emails: true,
    max_emails_per_sync: 50,
    ...overrides
  } as any;
}

describe('Email Provider Creation', () => {

  beforeAll(async () => {
    testDb = await createTestDbConnection();
    testTenant = uuidv4();

    // Create test tenant
    await tenantFixtureTable().insert({
      tenant: testTenant,
      client_name: 'Test Client',
      email: 'test@client.com',
      created_at: new Date(),
      updated_at: new Date()
    });

    microsoftProfileId = uuidv4();
    microsoftProfileSecretRef = `microsoft_profile_${microsoftProfileId}_client_secret`;
    microsoftProfileSecretEnvKey = `TENANT_${testTenant}_${microsoftProfileSecretRef}`;
    // Exercise the resolver's real environment-backed tenant secret provider.
    process.env[microsoftProfileSecretEnvKey] = microsoftProfileClientSecret;

    const now = new Date();
    await tenantTable('microsoft_profiles').insert({
      tenant: testTenant,
      profile_id: microsoftProfileId,
      display_name: 'Email Provider Creation Profile',
      display_name_normalized: 'email provider creation profile',
      client_id: microsoftProfileClientId,
      tenant_id: microsoftProfileTenantId,
      client_secret_ref: microsoftProfileSecretRef,
      capabilities: JSON.stringify(['email']),
      is_default: true,
      is_archived: false,
      archived_at: null,
      created_by: null,
      updated_by: null,
      created_at: now,
      updated_at: now
    });
    await tenantTable('microsoft_profile_consumer_bindings').insert({
      tenant: testTenant,
      consumer_type: 'email',
      profile_id: microsoftProfileId,
      created_by: null,
      updated_by: null,
      created_at: now,
      updated_at: now
    });
  });

  afterAll(async () => {
    // Cleanup
    delete process.env[microsoftProfileSecretEnvKey];
    await tenantTable('google_email_provider_config').delete();
    await tenantTable('microsoft_email_provider_config').delete();
    await tenantTable('email_providers').delete();
    await tenantTable('microsoft_profile_consumer_bindings').delete();
    await tenantTable('microsoft_profiles').delete();
    await tenantFixtureTable().where('tenant', testTenant).delete();
    await testDb.destroy();
  });

  describe('Google Provider', () => {
    it('should create a new Google email provider with all required fields', async () => {
      // Arrange
      const providerData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Client Gmail Support',
        mailbox: 'support@client.com',
        isActive: true,
        googleConfig: googleConfig()
      };

      // Act (skipAutomation: no live Pub/Sub or Gmail watch setup in tests)
      const result = await createEmailProvider(providerData, true);

      // Assert
      expect(result).toBeDefined();
      expect(result.provider).toBeDefined();
      expect(result.provider.id).toBeDefined();
      expect(result.provider.providerName).toBe('Client Gmail Support');
      expect(result.provider.mailbox).toBe('support@client.com');
      expect(result.provider.providerType).toBe('google');
      expect(result.provider.isActive).toBe(true);
      expect(result.provider.status).toBe('configuring');

      // Verify it was saved to the database
      const dbRecord = await tenantTable<any>('email_providers')
        .where('id', result.provider.id)
        .first();

      expect(dbRecord).toBeDefined();
      expect(dbRecord.tenant).toBe(testTenant);
      expect(dbRecord.mailbox).toBe('support@client.com');

      // Vendor config row: pubsub names are derived per tenant, and OAuth
      // client credentials live in tenant secrets, not the database.
      const configRecord = await tenantTable<any>('google_email_provider_config')
        .where('email_provider_id', result.provider.id)
        .first();

      expect(configRecord).toBeDefined();
      expect(configRecord.project_id).toBe('test-project-id');
      expect(configRecord.pubsub_topic_name).toBe(`gmail-notifications-${testTenant}`);
      expect(configRecord.pubsub_subscription_name).toBe(`gmail-webhook-${testTenant}`);
      expect(configRecord.label_filters).toEqual(['INBOX', 'UNREAD']);
      expect(configRecord.client_id).toBeNull();
      expect(configRecord.client_secret).toBeNull();
    });

    it('should create a Google provider with OAuth tokens', async () => {
      // Arrange
      const tokenExpiry = new Date(Date.now() + 3600000);
      const providerData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Authenticated Gmail',
        mailbox: 'authenticated@gmail.com',
        isActive: true,
        googleConfig: googleConfig({
          refresh_token: 'refresh-token-abc123',
          access_token: 'access-token-xyz789',
          token_expires_at: tokenExpiry.toISOString()
        })
      };

      // Act
      const result = await createEmailProvider(providerData, true);

      // Assert
      expect(result.provider).toBeDefined();

      const configRecord = await tenantTable<any>('google_email_provider_config')
        .where('email_provider_id', result.provider.id)
        .first();

      expect(configRecord.refresh_token).toBe('refresh-token-abc123');
      expect(configRecord.access_token).toBe('access-token-xyz789');
      expect(configRecord.token_expires_at).toBeDefined();
    });
  });

  describe('Microsoft Provider', () => {
    it('should create a new Microsoft email provider with all required fields', async () => {
      // Arrange
      const providerData = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'Client Outlook',
        mailbox: 'outlook-support@client.com',
        isActive: true,
        microsoftConfig: {
          client_id: 'microsoft-client-id',
          client_secret: 'microsoft-client-secret',
          tenant_id: 'common',
          redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback',
          max_emails_per_sync: 100
        } as any
      };

      // Act
      const result = await createEmailProvider(providerData, true);

      // Assert
      expect(result.provider).toBeDefined();
      expect(result.provider.providerName).toBe('Client Outlook');
      expect(result.provider.mailbox).toBe('outlook-support@client.com');
      expect(result.provider.providerType).toBe('microsoft');
      expect(result.provider.isActive).toBe(true);

      const configRecord = await tenantTable<any>('microsoft_email_provider_config')
        .where('email_provider_id', result.provider.id)
        .first();

      expect(configRecord).toMatchObject({
        client_id: microsoftProfileClientId,
        client_secret: microsoftProfileClientSecret,
        tenant_id: microsoftProfileTenantId,
        microsoft_profile_id: microsoftProfileId,
        client_secret_ref: microsoftProfileSecretRef,
        max_emails_per_sync: 100
      });
    });
  });

  describe('Provider Management', () => {
    it('should list all providers for a tenant', async () => {
      // Arrange - Create multiple providers
      await createEmailProvider({
        tenant: testTenant,
        providerType: 'google',
        providerName: 'Gmail Provider 1',
        mailbox: 'gmail1@client.com',
        isActive: true,
        googleConfig: googleConfig({ client_id: 'client1.apps.googleusercontent.com' })
      }, true);

      // Microsoft client credentials resolve through the tenant's bound profile.
      await createEmailProvider({
        tenant: testTenant,
        providerType: 'microsoft',
        providerName: 'Outlook Provider',
        mailbox: 'outlook@client.com',
        isActive: true,
        microsoftConfig: {
          client_id: 'microsoft-client-id',
          client_secret: 'microsoft-client-secret',
          tenant_id: 'common',
          redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback'
        } as any
      }, true);

      // Act - Query the database directly to verify
      const providers = await tenantTable<any>('email_providers').select('*');

      // Assert
      expect(providers.length).toBeGreaterThanOrEqual(2);
      expect(providers.some(p => p.mailbox === 'gmail1@client.com')).toBe(true);
      expect(providers.some(p => p.mailbox === 'outlook@client.com')).toBe(true);
    });

    it('should set default values correctly', async () => {
      // Arrange
      const minimalProviderData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Minimal Gmail',
        mailbox: 'minimal@gmail.com',
        isActive: true,
        googleConfig: googleConfig({ client_id: 'minimal.apps.googleusercontent.com' })
      };

      // Act
      const result = await createEmailProvider(minimalProviderData, true);

      // Assert - Check default values
      expect(result.provider.isActive).toBe(true);
      expect(result.provider.status).toBe('configuring'); // Default before webhook automation runs
      expect(result.provider.createdAt).toBeDefined();
      expect(result.provider.updatedAt).toBeDefined();
    });
  });
});
