/**
 * Integration test to ensure Google provider settings create proper database records
 * This test verifies the complete data flow from configuration to database persistence
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';

// Global test variables
let testDb: Knex;
let testTenant: string;
let emailProviderService: EmailProviderService;

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
      await testDb('tenants').insert({
        tenant: testTenant,
        company_name: 'Integration Test Company',
        email: 'integration-test@company.com',
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
      await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .delete();
        
      await testDb('tenants')
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
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-client-secret-value',
        projectId: 'test-project-id',
        redirectUri: 'http://localhost:3000/api/auth/google/callback',
        pubSubTopic: 'gmail-notifications',
        pubSubSubscription: 'gmail-webhook-subscription',
        labelFilters: ['INBOX', 'UNREAD'],
        autoProcessEmails: true,
        maxEmailsPerSync: 50
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
      connection_status: 'disconnected',
      folder_to_monitor: 'Inbox'
    });

    // Assert - Verify database record
    const dbRecord = await testDb('email_provider_configs')
      .where('id', createdProvider.id)
      .where('tenant', testTenant)
      .first();

    expect(dbRecord).toBeDefined();
    expect(dbRecord.id).toBe(createdProvider.id);
    expect(dbRecord.tenant).toBe(testTenant);
    expect(dbRecord.provider_type).toBe('google');
    expect(dbRecord.name).toBe('Integration Test Gmail');
    expect(dbRecord.mailbox).toBe('integration-test@gmail.com');
    expect(dbRecord.active).toBe(true);
    expect(dbRecord.connection_status).toBe('disconnected');
    expect(dbRecord.folder_to_monitor).toBe('Inbox');
    expect(dbRecord.webhook_notification_url).toBe('');

    // Verify the JSON provider_config contains all Google-specific fields
    const providerConfig = typeof dbRecord.provider_config === 'string' 
      ? JSON.parse(dbRecord.provider_config)
      : dbRecord.provider_config;

    expect(providerConfig).toMatchObject({
      clientId: 'test-client-id.apps.googleusercontent.com',
      clientSecret: 'test-client-secret-value',
      projectId: 'test-project-id',
      redirectUri: 'http://localhost:3000/api/auth/google/callback',
      pubSubTopic: 'gmail-notifications',
      pubSubSubscription: 'gmail-webhook-subscription',
      labelFilters: ['INBOX', 'UNREAD'],
      autoProcessEmails: true,
      maxEmailsPerSync: 50
    });

    // Verify timestamps were set
    expect(dbRecord.created_at).toBeDefined();
    expect(dbRecord.updated_at).toBeDefined();
  });

  it('should persist Google Workspace (non-gmail.com) configurations correctly', async () => {
    // Arrange - Google Workspace configuration
    const workspaceConfig = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Company Google Workspace',
      mailbox: 'support@customdomain.com',
      isActive: true,
      vendorConfig: {
        clientId: 'workspace-client.apps.googleusercontent.com',
        clientSecret: 'workspace-secret',
        projectId: 'company-workspace-project',
        pubSubTopic: 'workspace-email-notifications',
        pubSubSubscription: 'workspace-webhook-sub',
        labelFilters: ['INBOX', 'Support', 'CustomerService'],
        autoProcessEmails: false,
        maxEmailsPerSync: 200
      }
    };

    // Act
    const createdProvider = await emailProviderService.createProvider(workspaceConfig);

    // Assert - Verify custom domain is properly stored
    const dbRecord = await testDb('email_provider_configs')
      .where('id', createdProvider.id)
      .first();

    expect(dbRecord.mailbox).toBe('support@customdomain.com');
    expect(dbRecord.provider_type).toBe('google'); // Still Google provider type

    const providerConfig = typeof dbRecord.provider_config === 'string' 
      ? JSON.parse(dbRecord.provider_config)
      : dbRecord.provider_config;
    expect(providerConfig.labelFilters).toEqual(['INBOX', 'Support', 'CustomerService']);
    expect(providerConfig.autoProcessEmails).toBe(false);
    expect(providerConfig.maxEmailsPerSync).toBe(200);
  });

  it('should store OAuth tokens and authentication data when provided', async () => {
    // Arrange - Configuration with OAuth tokens
    const configWithAuth = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: 'Authenticated Gmail',
      mailbox: 'authenticated@gmail.com',
      isActive: true,
      vendorConfig: {
        clientId: 'auth-client-id',
        clientSecret: 'auth-secret',
        projectId: 'auth-project',
        pubSubTopic: 'auth-topic',
        pubSubSubscription: 'auth-sub',
        // OAuth tokens
        refreshToken: 'refresh-token-abc123',
        accessToken: 'access-token-xyz789',
        tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify'
      }
    };

    // Act
    const createdProvider = await emailProviderService.createProvider(configWithAuth);

    // Assert - Verify tokens are persisted
    const dbRecord = await testDb('email_provider_configs')
      .where('id', createdProvider.id)
      .first();

    const providerConfig = typeof dbRecord.provider_config === 'string' 
      ? JSON.parse(dbRecord.provider_config)
      : dbRecord.provider_config;
    expect(providerConfig.refreshToken).toBe('refresh-token-abc123');
    expect(providerConfig.accessToken).toBe('access-token-xyz789');
    expect(providerConfig.tokenExpiry).toBeDefined();
    expect(providerConfig.scope).toContain('gmail.readonly');
  });

  it('should enforce proper database constraints for Google providers', async () => {
    // Test 1: Provider type must be 'google' or 'microsoft'
    const invalidProviderType = {
      tenant: testTenant,
      providerType: 'invalid' as any,
      providerName: 'Invalid Provider',
      mailbox: 'test@example.com',
      isActive: true,
      vendorConfig: {}
    };

    await expect(
      emailProviderService.createProvider(invalidProviderType)
    ).rejects.toThrow(/violates check constraint/);

    // Test 2: Required fields must be present
    const missingRequiredFields = {
      tenant: testTenant,
      providerType: 'google' as const,
      providerName: '', // Empty name
      mailbox: 'test@gmail.com',
      isActive: true,
      vendorConfig: {}
    };

    await expect(
      emailProviderService.createProvider(missingRequiredFields)
    ).rejects.toThrow();

    // Verify no records were created
    const count = await testDb('email_provider_configs')
      .where('tenant', testTenant)
      .count('* as count')
      .first();

    expect(parseInt(count?.count || '0')).toBe(0);
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
        clientId: 'original-client-id',
        clientSecret: 'original-secret',
        projectId: 'original-project',
        pubSubTopic: 'original-topic',
        pubSubSubscription: 'original-sub',
        labelFilters: ['INBOX'],
        maxEmailsPerSync: 50
      }
    };

    const provider = await emailProviderService.createProvider(initialConfig);

    // Act - Update the provider
    const updatedProvider = await emailProviderService.updateProvider(provider.id, {
      providerName: 'Updated Gmail Config',
      vendorConfig: {
        labelFilters: ['INBOX', 'UNREAD', 'IMPORTANT'],
        maxEmailsPerSync: 100,
        refreshToken: 'new-refresh-token'
      }
    });

    // Assert - Verify updates in database
    const dbRecord = await testDb('email_provider_configs')
      .where('id', provider.id)
      .first();

    expect(dbRecord.name).toBe('Updated Gmail Config');
    
    const providerConfig = typeof dbRecord.provider_config === 'string' 
      ? JSON.parse(dbRecord.provider_config)
      : dbRecord.provider_config;
    // New values
    expect(providerConfig.labelFilters).toEqual(['INBOX', 'UNREAD', 'IMPORTANT']);
    expect(providerConfig.maxEmailsPerSync).toBe(100);
    expect(providerConfig.refreshToken).toBe('new-refresh-token');
    // Original values preserved
    expect(providerConfig.clientId).toBe('original-client-id');
    expect(providerConfig.projectId).toBe('original-project');
  });
});