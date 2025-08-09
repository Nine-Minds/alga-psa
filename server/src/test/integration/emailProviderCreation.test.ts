/**
 * Integration test for email provider creation functionality
 * This is a valid test that should pass but currently fails due to column name mismatches
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createEmailProvider } from '../../lib/actions/email-actions/emailProviderActions';
import { getCurrentTenant } from '../../lib/actions/tenantActions';

let testDb: Knex;
let testTenant: string;

// Mock the tenant functions to return our test tenant
vi.mock('../../lib/actions/tenantActions', () => ({
  getCurrentTenant: vi.fn()
}));

// Mock createTenantKnex to use our test database
vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

describe('Email Provider Creation', () => {
  
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    testTenant = uuidv4();
    
    // Create test tenant
    await testDb('tenants').insert({
      tenant: testTenant,
      company_name: 'Test Company',
      email: 'test@company.com',
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Mock getCurrentTenant to return our test tenant
    vi.mocked(getCurrentTenant).mockResolvedValue(testTenant);
  });

  afterAll(async () => {
    // Cleanup
    await testDb('email_provider_configs').where('tenant', testTenant).delete();
    await testDb('tenants').where('tenant', testTenant).delete();
    await testDb.destroy();
  });

  describe('Google Provider', () => {
    it('should create a new Google email provider with all required fields', async () => {
      // Arrange
      const providerData = {
        providerType: 'google' as const,
        providerName: 'Company Gmail Support',
        mailbox: 'support@company.com',
        vendorConfig: {
          clientId: 'test-client-id.apps.googleusercontent.com',
          clientSecret: 'test-client-secret',
          projectId: 'test-project-id',
          pubSubTopic: 'gmail-notifications',
          pubSubSubscription: 'gmail-webhook-subscription',
          labelFilters: ['INBOX', 'UNREAD'],
          autoProcessEmails: true,
          maxEmailsPerSync: 50
        }
      };

      // Act
      const result = await createEmailProvider(providerData);

      // Assert
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.providerName).toBe('Company Gmail Support');
      expect(result.mailbox).toBe('support@company.com');
      expect(result.providerType).toBe('google');
      expect(result.isActive).toBe(true);
      expect(result.status).toBe('disconnected');
      expect(result.vendorConfig).toMatchObject({
        clientId: 'test-client-id.apps.googleusercontent.com',
        clientSecret: 'test-client-secret',
        projectId: 'test-project-id',
        pubSubTopic: 'gmail-notifications',
        pubSubSubscription: 'gmail-webhook-subscription'
      });

      // Verify it was saved to the database
      const dbRecord = await testDb('email_provider_configs')
        .where('id', result.id)
        .first();

      expect(dbRecord).toBeDefined();
      expect(dbRecord.tenant).toBe(testTenant);
      expect(dbRecord.mailbox).toBe('support@company.com');
    });

    it('should create a Google provider with OAuth tokens', async () => {
      // Arrange
      const providerData = {
        providerType: 'google' as const,
        providerName: 'Authenticated Gmail',
        mailbox: 'authenticated@gmail.com',
        vendorConfig: {
          clientId: 'oauth-client-id.apps.googleusercontent.com',
          clientSecret: 'oauth-client-secret',
          projectId: 'oauth-project-id',
          pubSubTopic: 'oauth-notifications',
          pubSubSubscription: 'oauth-webhook-subscription',
          refreshToken: 'refresh-token-abc123',
          accessToken: 'access-token-xyz789',
          tokenExpiry: new Date(Date.now() + 3600000).toISOString()
        }
      };

      // Act
      const result = await createEmailProvider(providerData);

      // Assert
      expect(result).toBeDefined();
      expect(result.vendorConfig.refreshToken).toBe('refresh-token-abc123');
      expect(result.vendorConfig.accessToken).toBe('access-token-xyz789');
      expect(result.vendorConfig.tokenExpiry).toBeDefined();
    });
  });

  describe('Microsoft Provider', () => {
    it('should create a new Microsoft email provider with all required fields', async () => {
      // Arrange
      const providerData = {
        providerType: 'microsoft' as const,
        providerName: 'Company Outlook',
        mailbox: 'support@company.com',
        vendorConfig: {
          clientId: 'microsoft-client-id',
          clientSecret: 'microsoft-client-secret',
          tenantId: 'common',
          maxEmailsPerSync: 100
        }
      };

      // Act
      const result = await createEmailProvider(providerData);

      // Assert
      expect(result).toBeDefined();
      expect(result.providerName).toBe('Company Outlook');
      expect(result.mailbox).toBe('support@company.com');
      expect(result.providerType).toBe('microsoft');
      expect(result.isActive).toBe(true);
      expect(result.vendorConfig).toMatchObject({
        clientId: 'microsoft-client-id',
        clientSecret: 'microsoft-client-secret',
        tenantId: 'common'
      });
    });
  });

  describe('Provider Management', () => {
    it('should list all providers for a tenant', async () => {
      // Arrange - Create multiple providers
      await createEmailProvider({
        providerType: 'google',
        providerName: 'Gmail Provider 1',
        mailbox: 'gmail1@company.com',
        vendorConfig: {
          clientId: 'client1.apps.googleusercontent.com',
          clientSecret: 'secret1',
          projectId: 'project1',
          pubSubTopic: 'topic1',
          pubSubSubscription: 'sub1'
        }
      });

      await createEmailProvider({
        providerType: 'microsoft',
        providerName: 'Outlook Provider',
        mailbox: 'outlook@company.com',
        vendorConfig: {
          clientId: 'ms-client',
          clientSecret: 'ms-secret'
        }
      });

      // Act - Query the database directly to verify
      const providers = await testDb('email_provider_configs')
        .where('tenant', testTenant)
        .select('*');

      // Assert
      expect(providers.length).toBeGreaterThanOrEqual(2);
      expect(providers.some(p => p.mailbox === 'gmail1@company.com')).toBe(true);
      expect(providers.some(p => p.mailbox === 'outlook@company.com')).toBe(true);
    });

    it('should set default values correctly', async () => {
      // Arrange
      const minimalProviderData = {
        providerType: 'google' as const,
        providerName: 'Minimal Gmail',
        mailbox: 'minimal@gmail.com',
        vendorConfig: {
          clientId: 'minimal.apps.googleusercontent.com',
          clientSecret: 'minimal-secret',
          projectId: 'minimal-project',
          pubSubTopic: 'minimal-topic',
          pubSubSubscription: 'minimal-sub'
        }
      };

      // Act
      const result = await createEmailProvider(minimalProviderData);

      // Assert - Check default values
      expect(result.isActive).toBe(true); // Should default to true
      expect(result.status).toBe('disconnected'); // Should default to 'configuring'
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });
  });
});