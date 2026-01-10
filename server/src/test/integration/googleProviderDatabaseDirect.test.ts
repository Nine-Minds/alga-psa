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
          client_name: 'Test Client',
          email: 'test@client.com',
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
          client_id: null,
          client_secret: null,
          project_id: 'test-project-id',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'gmail-notifications',
          pubsub_subscription_name: 'gmail-webhook-subscription',
          label_filters: ['INBOX'],
          auto_process_emails: true,
          max_emails_per_sync: 50
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
      
      // Verify vendor config row values
      const vendorConfig = createdProvider.provider_config as any;
      expect(vendorConfig.client_id).toBeNull();
      expect(vendorConfig.client_secret).toBeNull();
      expect(vendorConfig.project_id).toBe('test-project-id');
      expect(vendorConfig.pubsub_topic_name).toBe('gmail-notifications');

      const labelFilters = Array.isArray(vendorConfig.label_filters)
        ? vendorConfig.label_filters
        : JSON.parse(vendorConfig.label_filters ?? '[]');
      expect(labelFilters).toEqual(['INBOX']);

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
        providerName: 'Client Workspace Account',
        mailbox: 'support@client.com',
        isActive: true,
        vendorConfig: {
          client_id: null,
          client_secret: null,
          project_id: 'client-project',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'workspace-notifications',
          pubsub_subscription_name: 'workspace-subscription',
          label_filters: ['INBOX', 'Support'],
          auto_process_emails: false,
          max_emails_per_sync: 100
        }
      };

      const createdProvider = await emailProviderService.createProvider(workspaceProviderData);

      // Verify the provider was created with custom domain
      expect(createdProvider.mailbox).toBe('support@client.com');
      expect(createdProvider.provider_type).toBe('google');
      
      // Verify vendor config
      const vendorConfig = createdProvider.provider_config as any;
      const labelFilters = Array.isArray(vendorConfig.label_filters)
        ? vendorConfig.label_filters
        : JSON.parse(vendorConfig.label_filters ?? '[]');

      expect(labelFilters).toEqual(['INBOX', 'Support']);
      expect(vendorConfig.auto_process_emails).toBe(false);
      expect(vendorConfig.max_emails_per_sync).toBe(100);
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
          client_id: null,
          client_secret: null,
          project_id: 'full-project',
          redirect_uri: 'https://app.example.com/api/auth/google/callback',
          pubsub_topic_name: 'custom-topic',
          pubsub_subscription_name: 'custom-subscription',
          label_filters: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL', 'IMPORTANT'],
          auto_process_emails: true,
          max_emails_per_sync: 500,
          refresh_token: 'stored-refresh-token',
          access_token: 'temp-access-token',
          token_expires_at: new Date(Date.now() + 3600000).toISOString(),
          scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify'
        }
      };

      const createdProvider = await emailProviderService.createProvider(fullProviderData);

      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', createdProvider.id)
        .where('tenant', testTenant)
        .first();

      const providerConfig = createdProvider.provider_config as any;

      // Verify all fields were saved
      expect(providerConfig.refresh_token).toBe('stored-refresh-token');
      expect(
        Array.isArray(providerConfig.label_filters)
          ? providerConfig.label_filters
          : JSON.parse(providerConfig.label_filters ?? '[]')
      ).toHaveLength(4);
      expect(providerConfig.max_emails_per_sync).toBe(500);
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
          client_id: null,
          client_secret: null,
          project_id: 'initial-project',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'initial-topic',
          pubsub_subscription_name: 'initial-sub',
          max_emails_per_sync: 50
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
      
      const vendorConfig = updatedProvider.provider_config as any;
        
      expect(vendorConfig.max_emails_per_sync).toBe(200);
      const labelFilters = Array.isArray(vendorConfig.label_filters)
        ? vendorConfig.label_filters
        : JSON.parse(vendorConfig.label_filters ?? '[]');
      expect(labelFilters).toEqual(['INBOX', 'IMPORTANT', 'SENT']);
      
      // Original config should be preserved
      expect(vendorConfig.project_id).toBe('initial-project');
      expect(vendorConfig.pubsub_topic_name).toBe('initial-topic');
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
        vendorConfig: {
          client_id: null,
          client_secret: null,
          project_id: 'project1',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'topic1',
          pubsub_subscription_name: 'sub1'
        }
      });

      await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'google',
        providerName: 'Gmail Provider 2',
        mailbox: 'provider2@client.com',
        isActive: true,
        vendorConfig: {
          client_id: null,
          client_secret: null,
          project_id: 'project2',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'topic2',
          pubsub_subscription_name: 'sub2'
        }
      });

      // Also create a Microsoft provider to ensure filtering works
      await emailProviderService.createProvider({
        tenant: testTenant,
        providerType: 'microsoft',
        providerName: 'Microsoft Provider',
        mailbox: 'microsoft@outlook.com',
        isActive: true,
        vendorConfig: { client_id: 'ms-client', client_secret: 'ms-secret', tenant_id: 'common', redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback' }
      });

      // List only Google providers
      const googleProviders = await emailProviderService.getProviders({
        tenant: testTenant,
        providerType: 'google'
      });

      expect(googleProviders).toHaveLength(2);
      expect(googleProviders.map(p => p.mailbox).sort()).toEqual([
        'provider1@gmail.com',
        'provider2@client.com'
      ]);

      // List all providers
      const allProviders = await emailProviderService.getProviders({
        tenant: testTenant
      });

      expect(allProviders).toHaveLength(3);
    });
  });
});
