/**
 * Integration tests for Google provider database save operations
 * Tests the complete flow of saving Google provider configurations
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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

describe('Google Provider Database Save Integration Tests', () => {
  
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    emailProviderService = new EmailProviderService();
    testTenant = uuidv4();
    
    // Create test tenant
    try {
      await testDb('tenants').insert({
        tenant: testTenant,
        client_name: 'Google Save Test Client',
        email: 'save-test@client.com',
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

  describe('Creating Google Provider via Service', () => {
    it('should save a complete Google provider configuration to the database', async () => {
      // Define the complete Google provider configuration
      const googleProviderConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Client Gmail Support',
        mailbox: 'support@client.com',
        isActive: true,
        vendorConfig: {
          clientId: 'test-client-id.apps.googleusercontent.com',
          clientSecret: 'test-client-secret-value',
          projectId: 'client-project-id',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
          labelFilters: ['INBOX', 'UNREAD'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      // Call the service
      const result = await emailProviderService.createProvider(googleProviderConfig);

      // Verify the result
      expect(result).toBeDefined();
      expect(result.provider_type).toBe('google');
      expect(result.mailbox).toBe('support@client.com');

      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', result.id)
        .first();

      expect(dbRecord).toBeDefined();
      expect(dbRecord.tenant).toBe(testTenant);
      expect(dbRecord.provider_type).toBe('google');
      expect(dbRecord.name).toBe('Client Gmail Support');
      expect(dbRecord.mailbox).toBe('support@client.com');
      expect(dbRecord.active).toBe(true);
      expect(dbRecord.connection_status).toBe('disconnected');

      // Verify the provider_config JSON structure
      const savedConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;
        
      expect(savedConfig).toEqual({
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-client-secret-value',
        projectId: 'client-project-id',
        pubSubTopic: 'gmail-notifications',
        pubSubSubscription: 'gmail-webhook-subscription',
        labelFilters: ['INBOX', 'UNREAD'],
        autoProcessEmails: true,
        maxEmailsPerSync: 50
      });
    });

    it('should handle Gmail-specific email addresses correctly', async () => {
      const gmailConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Personal Gmail',
        mailbox: 'user@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'gmail-client-id.apps.googleusercontent.com',
          clientSecret: 'gmail-secret',
          projectId: 'gmail-project',
          pubSubTopic: 'gmail-topic',
          pubSubSubscription: 'gmail-sub',
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      const provider = await emailProviderService.createProvider(gmailConfig);

      expect(provider.mailbox).toBe('user@gmail.com');
      expect(provider.provider_type).toBe('google');
      
      // Verify persisted data
      const dbRecord = await testDb('email_provider_configs')
        .where('id', provider.id)
        .first();
        
      expect(dbRecord.mailbox).toBe('user@gmail.com');
    });

    it('should handle Google Workspace custom domain emails', async () => {
      const workspaceConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Client Workspace',
        mailbox: 'support@customdomain.com',
        isActive: true,
        vendorConfig: {
          clientId: 'workspace-client-id.apps.googleusercontent.com',
          clientSecret: 'workspace-secret',
          projectId: 'workspace-project',
          pubSubTopic: 'workspace-topic',
          pubSubSubscription: 'workspace-sub',
          labelFilters: ['INBOX', 'Support', 'CustomerService'],
          autoProcessEmails: false,
          maxEmailsPerSync: 100
        }
      };

      const provider = await emailProviderService.createProvider(workspaceConfig);

      expect(provider.mailbox).toBe('support@customdomain.com');
      expect(provider.provider_config.labelFilters).toEqual(['INBOX', 'Support', 'CustomerService']);
      expect(provider.provider_config.autoProcessEmails).toBe(false);
      expect(provider.provider_config.maxEmailsPerSync).toBe(100);
    });

    it('should save OAuth tokens when provided', async () => {
      const configWithTokens = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'OAuth Gmail',
        mailbox: 'oauth@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'oauth-client-id.apps.googleusercontent.com',
          clientSecret: 'oauth-secret',
          projectId: 'oauth-project',
          pubSubTopic: 'oauth-topic',
          pubSubSubscription: 'oauth-sub',
          refreshToken: 'refresh-token-value',
          accessToken: 'access-token-value',
          tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
          labelFilters: ['INBOX'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      const provider = await emailProviderService.createProvider(configWithTokens);

      // Verify tokens are saved in provider_config
      expect(provider.provider_config.refreshToken).toBe('refresh-token-value');
      expect(provider.provider_config.accessToken).toBe('access-token-value');
      expect(provider.provider_config.tokenExpiry).toBeDefined();
      
      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', provider.id)
        .first();
        
      const savedConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;
        
      expect(savedConfig.refreshToken).toBe('refresh-token-value');
      expect(savedConfig.accessToken).toBe('access-token-value');
    });

    it('should validate required fields for Google provider', async () => {
      const incompleteConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Incomplete Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {} // Missing required vendor config
      };

      await expect(
        emailProviderService.createProvider(incompleteConfig)
      ).rejects.toThrow(/Google Client ID is required/);
    });

    it('should properly format and save all Google-specific configuration options', async () => {
      const fullGoogleConfig = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Full Config Gmail',
        mailbox: 'fullconfig@client.com',
        isActive: true,
        vendorConfig: {
          clientId: 'full-client-id.apps.googleusercontent.com',
          clientSecret: 'full-client-secret',
          projectId: 'full-project-id',
          pubSubTopic: 'custom-notifications-topic',
          pubSubSubscription: 'custom-webhook-subscription',
          labelFilters: ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL'],
          autoProcessEmails: true,
          maxEmailsPerSync: 250,
          redirectUri: 'https://app.example.com/api/auth/google/callback',
          scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify',
          watchExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      };

      const provider = await emailProviderService.createProvider(fullGoogleConfig);

      // Verify all configuration options are saved
      expect(provider.provider_config.labelFilters).toHaveLength(4);
      expect(provider.provider_config.maxEmailsPerSync).toBe(250);
      expect(provider.provider_config.pubSubTopic).toBe('custom-notifications-topic');
      expect(provider.provider_config.redirectUri).toBe('https://app.example.com/api/auth/google/callback');
      
      // Verify in database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', provider.id)
        .first();
        
      const savedConfig = typeof dbRecord.provider_config === 'string' 
        ? JSON.parse(dbRecord.provider_config)
        : dbRecord.provider_config;
        
      expect(savedConfig.scope).toBe('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify');
      expect(savedConfig.watchExpiration).toBeDefined();
    });
  });
});