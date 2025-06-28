import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createTenantKnex } from '../../lib/db';
import { Knex } from 'knex';
import { autoWireEmailProvider } from '../../lib/actions/email-actions/emailProviderActions';
import { v4 as uuidv4 } from 'uuid';

// Global test variables
let knex: Knex;
let tenantId: string;

describe('Google Provider Database Integration Tests', () => {
  
  beforeAll(async () => {
    // Setup: Establish DB connection
    try {
      const { knex: testKnex, tenant: testTenant } = await createTenantKnex();
      knex = testKnex;
      tenantId = testTenant || uuidv4();
      
      console.log(`Integration test setup complete for tenant: ${tenantId}`);
    } catch (error) {
      console.error("Failed to setup integration tests:", error);
      throw error;
    }
  });

  afterAll(async () => {
    // Teardown: Close DB connection
    if (knex) {
      await knex.destroy();
      console.log("Integration test database connection closed.");
    }
  });

  beforeEach(async () => {
    // Clean up any existing test data
    try {
      await knex('email_provider_configs')
        .where('tenant', tenantId)
        .where('mailbox', 'LIKE', '%test%')
        .delete();
    } catch (error) {
      console.warn('Could not clean up email_provider_configs:', error);
    }
  });

  afterEach(async () => {
    // Clean up test data after each test
    try {
      await knex('email_provider_configs')
        .where('tenant', tenantId)
        .where('mailbox', 'LIKE', '%test%')
        .delete();
    } catch (error) {
      console.warn('Could not clean up email_provider_configs:', error);
    }
  });

  describe('Google Provider Creation', () => {
    it('should create a Google provider record in the database', async () => {
      // Arrange
      const googleProviderConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Test Gmail Provider',
          mailbox: 'test@gmail.com',
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
      const result = await autoWireEmailProvider(googleProviderConfig);

      // Assert - Check the result
      expect(result.success).toBe(true);
      expect(result.provider).toBeDefined();
      expect(result.provider?.providerType).toBe('google');
      expect(result.provider?.mailbox).toBe('test@gmail.com');

      // Assert - Verify in database
      const dbRecord = await knex('email_provider_configs')
        .where('tenant', tenantId)
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
        providerType: 'google' as const,
        config: {
          providerName: 'Company Workspace',
          mailbox: 'support-test@company.com',
          clientId: 'workspace-client-id.apps.googleusercontent.com',
          clientSecret: 'workspace-secret',
          projectId: 'company-project',
          pubSubTopic: 'workspace-notifications',
          pubSubSubscription: 'workspace-subscription',
          labelFilters: ['INBOX', 'Support'],
          autoProcessEmails: false,
          maxEmailsPerSync: 100
        }
      };

      // Act
      const result = await autoWireEmailProvider(workspaceConfig);

      // Assert
      expect(result.success).toBe(true);
      expect(result.provider?.mailbox).toBe('support-test@company.com');

      // Verify in database
      const dbRecord = await knex('email_provider_configs')
        .where('tenant', tenantId)
        .where('mailbox', 'support-test@company.com')
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
        providerType: 'google' as const,
        config: {
          providerName: 'Full Config Test',
          mailbox: 'fullconfig-test@gmail.com',
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
      const result = await autoWireEmailProvider(fullConfig);

      // Assert
      expect(result.success).toBe(true);

      // Verify complete configuration in database
      const dbRecord = await knex('email_provider_configs')
        .where('tenant', tenantId)
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

    it('should prevent duplicate providers for the same mailbox', async () => {
      // Arrange
      const providerConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'First Provider',
          mailbox: 'duplicate-test@gmail.com',
          clientId: 'client-id-1',
          clientSecret: 'secret-1',
          projectId: 'project-1',
          pubSubTopic: 'topic-1',
          pubSubSubscription: 'sub-1'
        }
      };

      // Act - Create first provider
      const firstResult = await autoWireEmailProvider(providerConfig);
      expect(firstResult.success).toBe(true);

      // Try to create duplicate
      const duplicateConfig = {
        ...providerConfig,
        config: {
          ...providerConfig.config,
          providerName: 'Duplicate Provider',
          clientId: 'client-id-2'
        }
      };

      const duplicateResult = await autoWireEmailProvider(duplicateConfig);

      // Assert - Should either fail or update existing
      // The actual behavior depends on the implementation
      const records = await knex('email_provider_configs')
        .where('tenant', tenantId)
        .where('mailbox', 'duplicate-test@gmail.com');

      // Should only have one record for the same mailbox
      expect(records.length).toBeLessThanOrEqual(1);
    });

    it('should set correct default values for optional fields', async () => {
      // Arrange
      const minimalConfig = {
        providerType: 'google' as const,
        config: {
          providerName: 'Minimal Config',
          mailbox: 'minimal-test@gmail.com',
          clientId: 'minimal-client-id',
          clientSecret: 'minimal-secret',
          projectId: 'minimal-project',
          pubSubTopic: 'minimal-topic',
          pubSubSubscription: 'minimal-sub'
          // Not providing: labelFilters, autoProcessEmails, maxEmailsPerSync
        }
      };

      // Act
      const result = await autoWireEmailProvider(minimalConfig);

      // Assert
      expect(result.success).toBe(true);

      const dbRecord = await knex('email_provider_configs')
        .where('tenant', tenantId)
        .where('mailbox', 'minimal-test@gmail.com')
        .first();

      const providerConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config) 
        : dbRecord.provider_config;

      // Check defaults
      expect(providerConfig.labelFilters).toEqual(['INBOX']); // Default
      expect(providerConfig.autoProcessEmails).toBe(true); // Default
      expect(providerConfig.maxEmailsPerSync).toBe(50); // Default
    });
  });
});