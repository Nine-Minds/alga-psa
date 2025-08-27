/**
 * Integration tests demonstrating reasonable error messages for email provider validation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';

let testDb: Knex;
let testTenant: string;
let emailProviderService: EmailProviderService;

vi.mock('../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

describe('Email Provider Error Messages', () => {
  
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    emailProviderService = new EmailProviderService();
    testTenant = uuidv4();
    
    // Create test tenant
    try {
      await testDb('tenants').insert({
        tenant: testTenant,
        company_name: 'Error Test Company',
        email: 'error-test@company.com',
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (error) {
      console.error('Failed to create test tenant:', error);
    }
  });

  afterAll(async () => {
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

  describe('User-Friendly Error Messages', () => {
    it('should return clear error when provider name is missing', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: '',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'test.apps.googleusercontent.com',
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Provider name is required');
    });

    it('should return clear error when email is invalid', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'Test Provider',
        mailbox: 'not-a-valid-email',
        isActive: true,
        vendorConfig: {
          clientId: 'ms-client',
          clientSecret: 'ms-secret'
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Please enter a valid email address');
    });

    it('should return clear error when Google Client ID is missing', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Google Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          // Missing clientId
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Google Client ID is required');
    });

    it('should return multiple errors in a clear format', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: '',  // Missing
        mailbox: 'invalid-email',  // Invalid
        isActive: true,
        vendorConfig: {
          // Missing multiple required fields
          clientSecret: 'secret'
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow(/Please fix the following errors:[\s\S]*Provider name is required[\s\S]*Please enter a valid email address[\s\S]*Google Client ID is required/);
    });

    it('should return helpful error for invalid provider type', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'yahoo' as any,  // Invalid type
        providerName: 'Yahoo Mail',
        mailbox: 'test@yahoo.com',
        isActive: true,
        vendorConfig: {}
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Provider type must be either "google" or "microsoft"');
    });

    it('should return clear error for provider name that is too long', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'A'.repeat(256),  // Too long
        mailbox: 'test@outlook.com',
        isActive: true,
        vendorConfig: {
          clientId: 'ms-client',
          clientSecret: 'ms-secret'
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Provider name must be less than 255 characters');
    });

    it('should return helpful error for invalid Microsoft tenant ID', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'Microsoft Provider',
        mailbox: 'test@outlook.com',
        isActive: true,
        vendorConfig: {
          clientId: 'ms-client',
          clientSecret: 'ms-secret',
          tenantId: 'invalid-tenant-id'  // Not a valid GUID or special value
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Tenant ID must be "common", "organizations", "consumers", or a valid GUID');
    });

    it('should return clear error for invalid max emails per sync', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Google Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'test.apps.googleusercontent.com',
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub',
          maxEmailsPerSync: 2000  // Too high
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Max emails per sync must be between 1 and 1000');
    });

    it('should return helpful hint for Google Client ID format', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Google Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: '1234567890',  // Wrong format
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(emailProviderService.createProvider(config))
        .rejects.toThrow('Google Client ID should end with ".apps.googleusercontent.com"');
    });

    it('should successfully create provider when all fields are valid', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Valid Google Provider',
        mailbox: 'valid@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'valid-client.apps.googleusercontent.com',
          clientSecret: 'valid-secret',
          projectId: 'valid-project',
          pubSubTopic: 'valid-topic',
          pubSubSubscription: 'valid-sub'
        }
      };

      const result = await emailProviderService.createProvider(config);
      
      expect(result).toBeDefined();
      expect(result.name).toBe('Valid Google Provider');
      expect(result.mailbox).toBe('valid@gmail.com');
      expect(result.provider_type).toBe('google');
    });
  });
});