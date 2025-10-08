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

describe('Google Provider Database Integration Tests', () => {
  
  beforeAll(async () => {
    // Setup: Establish DB connection
    testDb = await createTestDbConnection();
    emailProviderService = new EmailProviderService();
    testTenant = uuidv4();
    
    // Create test tenant
    try {
      await testDb('tenants').insert({
        tenant: testTenant,
        client_name: 'Google Test Client',
        email: 'google-test@client.com',
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (error) {
      console.error('Failed to create test tenant:', error);
    }
  });

  afterAll(async () => {
    // Cleanup
    try {
      await testDb('email_provider_configs').where('tenant', testTenant).delete();
      await testDb('tenants').where('tenant', testTenant).delete();
    } catch (error) {
      // Ignore cleanup errors
    }
    
    if (testDb) {
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    // Clean up any existing test data
    try {
      await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      console.warn('Could not clean up email_provider_configs:', error);
    }
  });

  afterEach(async () => {
    // Clean up test data after each test
    try {
      await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      console.warn('Could not clean up email_provider_configs:', error);
    }
  });

  describe('Google Provider Creation', () => {
    it('should create a Google provider record in the database', async () => {
      // Arrange
      const googleProviderConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Test Gmail Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'test-client-id.apps.googleusercontent.com',
          clientSecret: 'test-client-secret',
          projectId: 'test-project-id',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      // Act
      const result = await emailProviderService.createProvider(googleProviderConfig);

      // Assert - Check the result
      expect(result).toBeDefined();
      expect(result.provider_type).toBe('google');
      expect(result.mailbox).toBe('test@gmail.com');

      // Assert - Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .where('mailbox', 'test@gmail.com')
        .first();

      expect(dbRecord).toBeDefined();
      expect(dbRecord.provider_type).toBe('google');
      expect(dbRecord.name).toBe('Test Gmail Provider');
      expect(dbRecord.active).toBe(true);
      expect(dbRecord.folder_to_monitor).toBe('Inbox');
      expect(dbRecord.connection_status).toBe('disconnected');

      // Verify provider_config JSON
      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config) 
        : dbRecord.provider_config;
      
      expect(providerConfig.clientId).toBe('test-client-id.apps.googleusercontent.com');
      expect(providerConfig.clientSecret).toBe('test-client-secret');
      expect(providerConfig.projectId).toBe('test-project-id');
      expect(providerConfig.pubSubTopic).toBe('gmail-notifications');
      expect(providerConfig.pubSubSubscription).toBe('gmail-webhook-subscription');
      expect(providerConfig.labelFilters).toEqual(['INBOX']);
      expect(providerConfig.autoProcessEmails).toBe(true);
      expect(providerConfig.maxEmailsPerSync).toBe(50);
    });

    it('should handle Google Workspace (non-gmail.com) email addresses', async () => {
      // Arrange
      const workspaceConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Client Workspace',
        mailbox: 'support-test@client.com',
        isActive: true,
        vendorConfig: {
          clientId: 'workspace-client-id.apps.googleusercontent.com',
          clientSecret: 'workspace-secret',
          projectId: 'client-project',
          pubSubTopic: 'workspace-notifications',
          pubSubSubscription: 'workspace-subscription',
          labelFilters: ['INBOX', 'Support'],
          autoProcessEmails: false,
          maxEmailsPerSync: 100
        }
      };

      // Act
      const result = await emailProviderService.createProvider(workspaceConfig);

      // Assert
      expect(result).toBeDefined();
      expect(result.mailbox).toBe('support-test@client.com');

      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .where('mailbox', 'support-test@client.com')
        .first();

      expect(dbRecord).toBeDefined();
      expect(dbRecord.provider_type).toBe('google');
      
      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config) 
        : dbRecord.provider_config;
      
      expect(providerConfig.labelFilters).toEqual(['INBOX', 'Support']);
      expect(providerConfig.autoProcessEmails).toBe(false);
      expect(providerConfig.maxEmailsPerSync).toBe(100);
    });

    it('should store all required Google OAuth configuration fields', async () => {
      // Arrange
      const fullConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Full Config Test',
        mailbox: 'fullconfig-test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'full-client-id.apps.googleusercontent.com',
          clientSecret: 'full-client-secret',
          projectId: 'full-project-id',
          pubSubTopic: 'custom-topic',
          pubSubSubscription: 'custom-subscription',
          labelFilters: ['INBOX', 'UNREAD', 'IMPORTANT'],
          autoProcessEmails: true,
          maxEmailsPerSync: 250
        }
      };

      // Act
      const result = await emailProviderService.createProvider(fullConfig);

      // Assert
      expect(result).toBeDefined();

      // Verify complete configuration in database
      const dbRecord = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .where('mailbox', 'fullconfig-test@gmail.com')
        .first();

      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config) 
        : dbRecord.provider_config;

      // Verify all fields are stored
      expect(providerConfig.clientId).toBe('full-client-id.apps.googleusercontent.com');
      expect(providerConfig.clientSecret).toBe('full-client-secret');
      expect(providerConfig.projectId).toBe('full-project-id');
      expect(providerConfig.pubSubTopic).toBe('custom-topic');
      expect(providerConfig.pubSubSubscription).toBe('custom-subscription');
      expect(providerConfig.labelFilters).toHaveLength(3);
      expect(providerConfig.maxEmailsPerSync).toBe(250);
    });

    it('should allow multiple providers for the same mailbox', async () => {
      // Arrange
      const providerConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'First Provider',
        mailbox: 'duplicate-test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'client-id-1.apps.googleusercontent.com',
          clientSecret: 'secret-1',
          projectId: 'project-1',
          pubSubTopic: 'topic-1',
          pubSubSubscription: 'sub-1'
        }
      };

      // Act - Create first provider
      const firstResult = await emailProviderService.createProvider(providerConfig);
      expect(firstResult).toBeDefined();

      // Try to create duplicate
      const duplicateConfig = {
        ...providerConfig,
        providerName: 'Duplicate Provider',
        vendorConfig: {
          ...providerConfig.vendorConfig,
          clientId: 'client-id-2.apps.googleusercontent.com'
        }
      };

      const duplicateResult = await emailProviderService.createProvider(duplicateConfig);

      // Assert - Should create multiple providers for same mailbox
      expect(duplicateResult).toBeDefined();
      
      const records = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .where('mailbox', 'duplicate-test@gmail.com');

      // Should have multiple records for the same mailbox
      expect(records.length).toBe(2);
    });

    it('should set correct default values for optional fields', async () => {
      // Arrange
      const minimalConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Minimal Config',
        mailbox: 'minimal-test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'minimal-client-id.apps.googleusercontent.com',
          clientSecret: 'minimal-secret',
          projectId: 'minimal-project',
          pubSubTopic: 'minimal-topic',
          pubSubSubscription: 'minimal-sub'
          // Not providing: labelFilters, autoProcessEmails, maxEmailsPerSync
        }
      };

      // Act
      const result = await emailProviderService.createProvider(minimalConfig);

      // Assert
      expect(result).toBeDefined();

      const dbRecord = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .where('mailbox', 'minimal-test@gmail.com')
        .first();

      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config) 
        : dbRecord.provider_config;

      // Check that optional fields are stored as provided
      expect(providerConfig.labelFilters).toBeUndefined(); // Not set
      expect(providerConfig.autoProcessEmails).toBeUndefined(); // Not set
      expect(providerConfig.maxEmailsPerSync).toBeUndefined(); // Not set
    });
  });
});