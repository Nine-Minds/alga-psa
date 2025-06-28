import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';

// Mock createTenantKnex for the EmailProviderService
let testDb: Knex;
let testTenant: string;

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

describe('Google Provider Database Direct Integration Tests', () => {
  
  beforeAll(async () => {
    // Create test database connection
    testDb = await createTestDbConnection();
    console.log('Test database connection established');
  });

  afterAll(async () => {
    // Close database connection
    if (testDb) {
      await testDb.destroy();
      console.log('Test database connection closed');
    }
  });

  beforeEach(async () => {
    // Generate a unique tenant for each test
    testTenant = uuidv4();
    
    // Ensure test tables exist and clean up any previous test data
    try {
      // Check if tables exist by querying them
      await testDb('email_provider_configs').limit(1);
      
      // Create tenant record to satisfy foreign key constraint
      const tenantExists = await testDb('tenants')
        .where('tenant', testTenant)
        .first();
        
      if (!tenantExists) {
        await testDb('tenants').insert({
          tenant: testTenant,
          company_name: 'Test Company',
          email: 'test@company.com',
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    } catch (error) {
      console.warn('Tables may not exist, skipping setup:', error.message);
    }
  });

  afterEach(async () => {
    // Clean up test data
    if (testTenant) {
      try {
        await testDb('email_provider_configs')
          .where('tenant', testTenant)
          .delete();
          
        await testDb('tenants')
          .where('tenant', testTenant)
          .delete();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe('Google Provider Database Operations', () => {
    it('should create a Google provider record in the database', async () => {
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

      // Create provider
      const createdProvider = await emailProviderService.createProvider(googleProviderData);

      // Verify the provider was created
      expect(createdProvider).toBeDefined();
      expect(createdProvider.id).toBeDefined();
      expect(createdProvider.tenant).toBe(testTenant);
      expect(createdProvider.provider_type).toBe('google');
      expect(createdProvider.name).toBe('Test Gmail Provider');
      expect(createdProvider.mailbox).toBe('test@gmail.com');
      expect(createdProvider.active).toBe(true);
      expect(createdProvider.connection_status).toBe('disconnected');
      
      // Parse and verify provider_config
      const vendorConfig = typeof createdProvider.provider_config === 'string' 
        ? JSON.parse(createdProvider.provider_config)
        : createdProvider.provider_config;
        
      expect(vendorConfig.clientId).toBe('test-client-id.apps.googleusercontent.com');
      expect(vendorConfig.clientSecret).toBe('test-client-secret');
      expect(vendorConfig.projectId).toBe('test-project-id');
      expect(vendorConfig.pubSubTopic).toBe('gmail-notifications');
      expect(vendorConfig.labelFilters).toEqual(['INBOX']);

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
      expect(dbRecord.folder_to_monitor).toBe('Inbox');
    });

    it('should handle Google Workspace email addresses', async () => {
      const emailProviderService = new EmailProviderService();
      
      const workspaceProviderData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Company Workspace Account',
        mailbox: 'support@company.com',
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
      
      // Verify vendor config
      const vendorConfig = typeof createdProvider.provider_config === 'string' 
        ? JSON.parse(createdProvider.provider_config)
        : createdProvider.provider_config;
        
      expect(vendorConfig.labelFilters).toEqual(['INBOX', 'Support']);
      expect(vendorConfig.autoProcessEmails).toBe(false);
      expect(vendorConfig.maxEmailsPerSync).toBe(100);
    });

    it('should store all Google-specific configuration fields', async () => {
      const emailProviderService = new EmailProviderService();
      
      const fullProviderData = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Full Config Gmail',
        mailbox: 'fullconfig@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'full-client-id',
          clientSecret: 'full-secret',
          projectId: 'full-project',
          redirectUri: 'https://app.example.com/api/auth/google/callback',
          pubSubTopic: 'custom-topic',
          pubSubSubscription: 'custom-subscription',
          labelFilters: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'IMPORTANT'],
          autoProcessEmails: true,
          maxEmailsPerSync: 500,
          refreshToken: 'stored-refresh-token',
          accessToken: 'temp-access-token',
          tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
          scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify'
        }
      };

      const createdProvider = await emailProviderService.createProvider(fullProviderData);

      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', createdProvider.id)
        .where('tenant', testTenant)
        .first();

      const providerConfig = typeof dbRecord.provider_config === 'string'
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;

      // Verify all fields were saved
      expect(providerConfig.refreshToken).toBe('stored-refresh-token');
      expect(providerConfig.labelFilters).toHaveLength(4);
      expect(providerConfig.maxEmailsPerSync).toBe(500);
      expect(providerConfig.scope).toContain('gmail.readonly');
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
          clientId: 'initial-client-id',
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
      
      const vendorConfig = typeof updatedProvider.provider_config === 'string'
        ? JSON.parse(updatedProvider.provider_config)
        : updatedProvider.provider_config;
        
      expect(vendorConfig.maxEmailsPerSync).toBe(200);
      expect(vendorConfig.labelFilters).toEqual(['INBOX', 'IMPORTANT', 'SENT']);
      
      // Original config should be preserved
      expect(vendorConfig.clientId).toBe('initial-client-id');
      expect(vendorConfig.projectId).toBe('initial-project');
    });

    it('should list Google providers for a tenant', async () => {
      const emailProviderService = new EmailProviderService();
      
      // Create multiple providers
      await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'google',
        providerName: 'Gmail Provider 1',
        mailbox: 'provider1@gmail.com',
        isActive: true,
        vendorConfig: { clientId: 'client1', clientSecret: 'secret1', projectId: 'project1', pubSubTopic: 'topic1', pubSubSubscription: 'sub1' }
      });

      await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'google',
        providerName: 'Gmail Provider 2',
        mailbox: 'provider2@company.com',
        isActive: true,
        vendorConfig: { clientId: 'client2', clientSecret: 'secret2', projectId: 'project2', pubSubTopic: 'topic2', pubSubSubscription: 'sub2' }
      });

      // Also create a Microsoft provider to ensure filtering works
      await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'microsoft',
        providerName: 'Microsoft Provider',
        mailbox: 'microsoft@outlook.com',
        isActive: true,
        vendorConfig: { clientId: 'ms-client', clientSecret: 'ms-secret' }
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
  });
});