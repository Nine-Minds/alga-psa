/**
 * Integration tests for email provider database operations
 * Tests actual database creation and persistence of email provider configurations
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';
import { createTenantKnex } from '../../lib/db';

// Mock createTenantKnex to use test database
let testDb: Knex;
let testTenant: string;

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn()
}));

describe('Email Provider Database Integration Tests', () => {
  let tablesExist = false;

  beforeAll(async () => {
    // Create test database connection
    testDb = await createTestDbConnection();
    
    // Skip migrations - assume database is already set up
    // In a real CI/CD environment, migrations would be run before tests
    
    // Check if email_provider_configs table exists
    try {
      await testDb('email_provider_configs').limit(1);
      tablesExist = true;
    } catch (error) {
      console.warn('email_provider_configs table does not exist. Skipping integration tests.');
      tablesExist = false;
    }
  });

  afterAll(async () => {
    // Close database connection
    if (testDb) {
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    // Generate a unique tenant for each test
    testTenant = uuidv4();
    
    // Mock createTenantKnex to return our test database
    vi.mocked(createTenantKnex).mockResolvedValue({
      knex: testDb,
      tenant: testTenant
    });

    // Check if tables exist before running tests
    try {
      // Ensure tenant exists in tenants table
      const tenantExists = await testDb('tenants')
        .where('tenant', testTenant)
        .first();
      
      if (!tenantExists) {
        await testDb('tenants').insert({
          tenant: testTenant,
          company_name: 'Email Provider Test Company',
          email: 'test@company.com',
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    } catch (error) {
      console.warn('Tenants table may not exist, skipping tenant setup:', error);
    }
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await testDb('email_processed_messages')
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      // Table might not exist
    }
    
    try {
      await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      // Table might not exist
    }
    
    try {
      await testDb('tenants')
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      // Table might not exist
    }
  });

  describe('Google Provider Database Operations', () => {
    it.skipIf(!tablesExist)('should create a Google provider record in the database', async () => {
      const emailProviderService = new EmailProviderService();
      
      const googleProviderData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Test Gmail Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'test-client-id.apps.googleusercontent.com',
          clientSecret: 'test-client-secret',
          projectId: 'test-project-id',
          redirectUri: 'http://localhost:3000/api/auth/google/callback',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      // Create provider using the service
      const createdProvider = await emailProviderService.createProvider(googleProviderData);

      // Verify the provider was created
      expect(createdProvider).toBeDefined();
      expect(createdProvider.id).toBeDefined();
      expect(createdProvider.tenant).toBe(testTenant);
      expect(createdProvider.provider_type).toBe('google');
      expect(createdProvider.name).toBe('Test Gmail Provider');
      expect(createdProvider.mailbox).toBe('test@gmail.com');
      expect(createdProvider.active).toBe(true);
      expect(createdProvider.provider_config).toMatchObject(googleProviderData.vendorConfig);

      // Verify directly in the database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', createdProvider.id)
        .where('tenant', testTenant)
        .first();

      expect(dbRecord).toBeDefined();
      expect(dbRecord.provider_type).toBe('google');
      expect(dbRecord.name).toBe('Test Gmail Provider');
      expect(dbRecord.mailbox).toBe('test@gmail.com');
      expect(dbRecord.active).toBe(true);
      expect(dbRecord.connection_status).toBe('disconnected');
      expect(dbRecord.folder_to_monitor).toBe('Inbox');
      
      // Parse and verify provider_config JSON
      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;
      expect(providerConfig.clientId).toBe('test-client-id.apps.googleusercontent.com');
      expect(providerConfig.clientSecret).toBe('test-client-secret');
      expect(providerConfig.projectId).toBe('test-project-id');
      expect(providerConfig.pubSubTopic).toBe('gmail-notifications');
      expect(providerConfig.labelFilters).toEqual(['INBOX']);
    });

    it('should handle Google Workspace email addresses', async () => {
      const emailProviderService = new EmailProviderService();
      
      const workspaceProviderData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Company Workspace Account',
        mailbox: 'support@company.com', // Non-gmail domain
        isActive: true,
        vendorConfig: {
          clientId: 'workspace-client-id.apps.googleusercontent.com',
          clientSecret: 'workspace-secret',
          projectId: 'company-project',
          redirectUri: 'http://localhost:3000/api/auth/google/callback',
          pubSubTopic: 'workspace-notifications',
          pubSubSubscription: 'workspace-subscription',
          labelFilters: ['INBOX', 'Support'],
          autoProcessEmails: false,
          maxEmailsPerSync: 100
        }
      };

      const createdProvider = await emailProviderService.createProvider(workspaceProviderData);

      // Verify the provider was created with custom domain
      expect(createdProvider.mailbox).toBe('support@company.com');
      expect(createdProvider.provider_type).toBe('google');
      
      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', createdProvider.id)
        .where('tenant', testTenant)
        .first();

      expect(dbRecord.mailbox).toBe('support@company.com');
      
      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;
      expect(providerConfig.labelFilters).toEqual(['INBOX', 'Support']);
      expect(providerConfig.autoProcessEmails).toBe(false);
    });

    it('should update an existing Google provider', async () => {
      const emailProviderService = new EmailProviderService();
      
      // First create a provider
      const initialData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Initial Gmail Provider',
        mailbox: 'initial@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'initial-client-id.apps.googleusercontent.com',
          clientSecret: 'initial-secret',
          projectId: 'initial-project',
          pubSubTopic: 'initial-topic',
          pubSubSubscription: 'initial-sub',
          maxEmailsPerSync: 50
        }
      };

      const createdProvider = await emailProviderService.createProvider(initialData);

      // Update the provider
      const updateData = {
        providerName: 'Updated Gmail Provider',
        isActive: false,
        vendorConfig: {
          maxEmailsPerSync: 200,
          labelFilters: ['INBOX', 'IMPORTANT', 'SENT']
        }
      };

      const updatedProvider = await emailProviderService.updateProvider(
        createdProvider.id, 
        updateData
      );

      // Verify the update
      expect(updatedProvider.name).toBe('Updated Gmail Provider');
      expect(updatedProvider.active).toBe(false);
      expect(updatedProvider.provider_config.maxEmailsPerSync).toBe(200);
      expect(updatedProvider.provider_config.labelFilters).toEqual(['INBOX', 'IMPORTANT', 'SENT']);
      
      // Original config should be preserved
      expect(updatedProvider.provider_config.clientId).toBe('initial-client-id.apps.googleusercontent.com');
      expect(updatedProvider.provider_config.projectId).toBe('initial-project');

      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', createdProvider.id)
        .where('tenant', testTenant)
        .first();

      expect(dbRecord.name).toBe('Updated Gmail Provider');
      expect(dbRecord.active).toBe(false);
    });

    it('should list all Google providers for a tenant', async () => {
      const emailProviderService = new EmailProviderService();
      
      // Create multiple providers
      const provider1 = await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'google',
        providerName: 'Gmail Provider 1',
        mailbox: 'provider1@gmail.com',
        isActive: true,
        vendorConfig: { 
          clientId: 'client1.apps.googleusercontent.com',
          clientSecret: 'secret-1',
          projectId: 'project-1',
          pubSubTopic: 'topic-1',
          pubSubSubscription: 'sub-1'
        }
      });

      const provider2 = await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'google',
        providerName: 'Gmail Provider 2',
        mailbox: 'provider2@company.com',
        isActive: true,
        vendorConfig: { 
          clientId: 'client2.apps.googleusercontent.com',
          clientSecret: 'secret-2',
          projectId: 'project-2',
          pubSubTopic: 'topic-2',
          pubSubSubscription: 'sub-2'
        }
      });

      // Also create a Microsoft provider to ensure filtering works
      await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'microsoft',
        providerName: 'Microsoft Provider',
        mailbox: 'microsoft@outlook.com',
        isActive: true,
        vendorConfig: { 
          clientId: 'ms-client',
          clientSecret: 'ms-secret'
        }
      });

      // List only Google providers
      const googleProviders = await emailProviderService.getProviders({
        tenant: testTenant,
        providerType: 'google'
      });

      expect(googleProviders).toHaveLength(2);
      expect(googleProviders.map(p => p.mailbox).sort()).toEqual([
        'provider1@gmail.com',
        'provider2@company.com'
      ]);

      // List all providers
      const allProviders = await emailProviderService.getProviders({
        tenant: testTenant
      });

      expect(allProviders).toHaveLength(3);
    });

    it('should handle provider creation with all optional fields', async () => {
      const emailProviderService = new EmailProviderService();
      
      const fullProviderData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Full Config Gmail',
        mailbox: 'full-config@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'full-client-id.apps.googleusercontent.com',
          clientSecret: 'full-secret',
          projectId: 'full-project',
          redirectUri: 'https://app.example.com/api/auth/google/callback',
          pubSubTopic: 'custom-topic',
          pubSubSubscription: 'custom-subscription',
          labelFilters: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'],
          autoProcessEmails: true,
          maxEmailsPerSync: 500,
          refreshToken: 'stored-refresh-token',
          accessToken: 'temp-access-token',
          tokenExpiry: new Date(Date.now() + 3600000).toISOString()
        }
      };

      const createdProvider = await emailProviderService.createProvider(fullProviderData);

      // Verify all fields were saved
      const dbRecord = await testDb('email_provider_configs')
        .where('id', createdProvider.id)
        .where('tenant', testTenant)
        .first();

      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;
      expect(providerConfig.refreshToken).toBe('stored-refresh-token');
      expect(providerConfig.labelFilters).toHaveLength(3);
      expect(providerConfig.maxEmailsPerSync).toBe(500);
    });

    it('should enforce database constraints', async () => {
      const emailProviderService = new EmailProviderService();
      
      // Try to create provider with invalid provider_type
      const invalidData = {
        tenant: testTenant,
        providerType: 'invalid' as any, // Invalid type
        providerName: 'Invalid Provider',
        mailbox: 'test@example.com',
        isActive: true,
        vendorConfig: {}
      };

      await expect(
        emailProviderService.createProvider(invalidData)
      ).rejects.toThrow();

      // Verify no record was created
      const count = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .count('* as count')
        .first();

      expect(count?.count).toBe('0');
    });
  });
});