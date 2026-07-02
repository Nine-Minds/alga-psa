/**
 * Integration test to ensure Google provider settings create proper database records
 * This test verifies the complete data flow from configuration to database persistence
 *
 * Persistence targets the current split schema: email_providers plus the
 * snake_case google_email_provider_config table. Input validation messages are
 * owned by EmailProviderValidator.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';
import { EmailProviderValidator } from '../../services/email/EmailProviderValidator';

// Global test variables
let testDb: Knex;
let testTenant: string;
let emailProviderService: EmailProviderService;

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Google provider data persistence test fixture creates and removes tenant rows'
  );
}

// Mock createTenantKnex to use our test database
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

describe('Google Provider Data Persistence Tests', () => {

  beforeAll(async () => {
    // Setup test database connection
    testDb = await createTestDbConnection();
    emailProviderService = new EmailProviderService();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    // Create a unique tenant for each test
    testTenant = uuidv4();

    try {
      // Create tenant record
      await tenantFixtureTable().insert({
        tenant: testTenant,
        client_name: 'Integration Test Client',
        email: 'integration-test@client.com',
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (error) {
      console.error('Failed to create test tenant:', error);
      throw error;
    }
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('email_providers').delete();

      await tenantFixtureTable()
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  });

  it('should create a Google provider record with all required fields in the database', async () => {
    // Arrange - Complete Google provider configuration
    const googleProviderConfig = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Integration Test Gmail',
      mailbox: 'integration-test@gmail.com',
      isActive: true,
      vendorConfig: {
        client_id: 'test-client-id.apps.googleusercontent.com',
        client_secret: 'test-client-secret-value',
        project_id: 'test-project-id',
        redirect_uri: 'http://localhost:3000/api/auth/google/callback',
        pubsub_topic_name: 'gmail-notifications',
        pubsub_subscription_name: 'gmail-webhook-subscription',
        label_filters: ['INBOX', 'UNREAD'],
        auto_process_emails: true,
        max_emails_per_sync: 50
      }
    };

    // Act - Create the provider
    const createdProvider = await emailProviderService.createProvider(googleProviderConfig);

    // Assert - Verify the returned provider object
    expect(createdProvider).toMatchObject({
      tenant: testTenant,
      provider_type: 'google',
      name: 'Integration Test Gmail',
      mailbox: 'integration-test@gmail.com',
      active: true,
      connection_status: 'configuring',
      folder_to_monitor: 'Inbox'
    });

    // Assert - Verify main provider record
    const providerRecord = await tenantTable<any>('email_providers')
      .where('id', createdProvider.id)
      .first();

    expect(providerRecord).toBeDefined();
    expect(providerRecord.id).toBe(createdProvider.id);
    expect(providerRecord.tenant).toBe(testTenant);
    expect(providerRecord.provider_type).toBe('google');
    expect(providerRecord.provider_name).toBe('Integration Test Gmail');
    expect(providerRecord.mailbox).toBe('integration-test@gmail.com');
    expect(providerRecord.is_active).toBe(true);
    expect(providerRecord.status).toBe('configuring');

    // Verify the vendor config row contains all Google-specific fields
    const configRecord = await tenantTable<any>('google_email_provider_config')
      .where('email_provider_id', createdProvider.id)
      .first();

    expect(configRecord).toMatchObject({
      email_provider_id: createdProvider.id,
      tenant: testTenant,
      client_id: 'test-client-id.apps.googleusercontent.com',
      client_secret: 'test-client-secret-value',
      project_id: 'test-project-id',
      redirect_uri: 'http://localhost:3000/api/auth/google/callback',
      pubsub_topic_name: 'gmail-notifications',
      pubsub_subscription_name: 'gmail-webhook-subscription',
      auto_process_emails: true,
      max_emails_per_sync: 50
    });
    expect(configRecord.label_filters).toEqual(['INBOX', 'UNREAD']);

    // Verify timestamps were set
    expect(providerRecord.created_at).toBeDefined();
    expect(providerRecord.updated_at).toBeDefined();
    expect(configRecord.created_at).toBeDefined();
    expect(configRecord.updated_at).toBeDefined();
  });

  it('should persist Google Workspace (non-gmail.com) configurations correctly', async () => {
    // Arrange - Google Workspace configuration
    const workspaceConfig = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Client Google Workspace',
      mailbox: 'support@customdomain.com',
      isActive: true,
      vendorConfig: {
        client_id: 'workspace-client.apps.googleusercontent.com',
        client_secret: 'workspace-secret',
        project_id: 'client-workspace-project',
        redirect_uri: 'http://localhost:3000/api/auth/google/callback',
        pubsub_topic_name: 'workspace-email-notifications',
        pubsub_subscription_name: 'workspace-webhook-sub',
        label_filters: ['INBOX', 'Support', 'CustomerService'],
        auto_process_emails: false,
        max_emails_per_sync: 200
      }
    };

    // Act
    const createdProvider = await emailProviderService.createProvider(workspaceConfig);

    // Assert - Verify custom domain is properly stored
    const providerRecord = await tenantTable<any>('email_providers')
      .where('id', createdProvider.id)
      .first();

    expect(providerRecord.mailbox).toBe('support@customdomain.com');
    expect(providerRecord.provider_type).toBe('google'); // Still Google provider type

    const configRecord = await tenantTable<any>('google_email_provider_config')
      .where('email_provider_id', createdProvider.id)
      .first();
    expect(configRecord.label_filters).toEqual(['INBOX', 'Support', 'CustomerService']);
    expect(configRecord.auto_process_emails).toBe(false);
    expect(configRecord.max_emails_per_sync).toBe(200);
  });

  it('should store OAuth tokens and authentication data when provided', async () => {
    // Arrange - Configuration with OAuth tokens
    const tokenExpiry = new Date(Date.now() + 3600000);
    const configWithAuth = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Authenticated Gmail',
      mailbox: 'authenticated@gmail.com',
      isActive: true,
      vendorConfig: {
        client_id: 'auth-client-id.apps.googleusercontent.com',
        client_secret: 'auth-secret',
        project_id: 'auth-project',
        redirect_uri: 'http://localhost:3000/api/auth/google/callback',
        pubsub_topic_name: 'auth-topic',
        pubsub_subscription_name: 'auth-sub',
        // OAuth tokens
        refresh_token: 'refresh-token-abc123',
        access_token: 'access-token-xyz789',
        token_expires_at: tokenExpiry.toISOString()
      }
    };

    // Act
    const createdProvider = await emailProviderService.createProvider(configWithAuth);

    // Assert - Verify tokens are persisted
    const configRecord = await tenantTable<any>('google_email_provider_config')
      .where('email_provider_id', createdProvider.id)
      .first();

    expect(configRecord.refresh_token).toBe('refresh-token-abc123');
    expect(configRecord.access_token).toBe('access-token-xyz789');
    expect(configRecord.token_expires_at).toBeDefined();
    expect(new Date(configRecord.token_expires_at).getTime()).toBe(tokenExpiry.getTime());
  });

  it('should reject invalid provider types before any database write', async () => {
    // Validation ownership: EmailProviderValidator rejects unknown provider types
    const invalidProviderType = {
      tenant: testTenant,
      providerType: 'invalid' as any,
      providerName: 'Invalid Provider',
      mailbox: 'test@example.com',
      isActive: true,
      vendorConfig: {}
    };

    const errors = EmailProviderValidator.validateCreateProvider(invalidProviderType);
    expect(EmailProviderValidator.formatValidationErrors(errors)).toMatch(
      /Provider type must be either "google", "microsoft", or "imap"/
    );

    // Verify no records exist with the invalid provider type
    const count = await tenantTable<any>('email_providers')
      .where('provider_type', 'invalid')
      .count('* as count')
      .first();

    expect(parseInt(String(count?.count ?? '0'))).toBe(0);
  });

  it('should enforce validation for required fields', () => {
    // Test that empty provider name is not allowed
    const emptyNameConfig = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: '', // Empty name should fail validation
      mailbox: 'minimal@gmail.com',
      isActive: true,
      vendorConfig: {
        clientId: 'test.apps.googleusercontent.com',
        clientSecret: 'secret',
        projectId: 'project',
        pubSubTopic: 'topic',
        pubSubSubscription: 'sub'
      }
    };

    expect(
      EmailProviderValidator.formatValidationErrors(
        EmailProviderValidator.validateCreateProvider(emptyNameConfig)
      )
    ).toMatch(/Provider name is required/);

    // Test that missing vendor config fails
    const noVendorConfig = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Test Provider',
      mailbox: 'minimal@gmail.com',
      isActive: true,
      vendorConfig: {}
    };

    expect(
      EmailProviderValidator.formatValidationErrors(
        EmailProviderValidator.validateCreateProvider(noVendorConfig)
      )
    ).toMatch(/Google Client ID is required/);
  });

  it('should correctly handle updates to existing Google provider configurations', async () => {
    // Arrange - Create initial provider
    const initialConfig = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Original Gmail Config',
      mailbox: 'original@gmail.com',
      isActive: true,
      vendorConfig: {
        client_id: 'original-client-id.apps.googleusercontent.com',
        client_secret: 'original-secret',
        project_id: 'original-project',
        redirect_uri: 'http://localhost:3000/api/auth/google/callback',
        pubsub_topic_name: 'original-topic',
        pubsub_subscription_name: 'original-sub',
        label_filters: ['INBOX'],
        max_emails_per_sync: 50
      }
    };

    const provider = await emailProviderService.createProvider(initialConfig);

    // Act - Update the provider
    await emailProviderService.updateProvider(provider.id, {
      providerName: 'Updated Gmail Config',
      vendorConfig: {
        label_filters: ['INBOX', 'UNREAD', 'IMPORTANT'],
        max_emails_per_sync: 100,
        refresh_token: 'new-refresh-token'
      }
    });

    // Assert - Verify updates in database
    const providerRecord = await tenantTable<any>('email_providers')
      .where('id', provider.id)
      .first();

    expect(providerRecord.provider_name).toBe('Updated Gmail Config');

    const configRecord = await tenantTable<any>('google_email_provider_config')
      .where('email_provider_id', provider.id)
      .first();
    // New values
    expect(configRecord.label_filters).toEqual(['INBOX', 'UNREAD', 'IMPORTANT']);
    expect(configRecord.max_emails_per_sync).toBe(100);
    expect(configRecord.refresh_token).toBe('new-refresh-token');
    // Original values preserved
    expect(configRecord.client_id).toBe('original-client-id.apps.googleusercontent.com');
    expect(configRecord.project_id).toBe('original-project');
  });
});
