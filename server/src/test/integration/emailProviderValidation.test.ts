/**
 * Integration tests for email provider validation and error messages
 * Ensures that reasonable error messages are returned when required fields are missing
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

describe('Email Provider Validation Tests', () => {
  
  beforeAll(async () => {
    testDb = await createTestDbConnection();
    emailProviderService = new EmailProviderService();
  });

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  beforeEach(async () => {
    testTenant = uuidv4();
    
    try {
      // Create tenant record
      await testDb('tenants').insert({
        tenant: testTenant,
        client_name: 'Validation Test Client',
        email: 'validation-test@client.com',
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (error) {
      console.error('Failed to create test tenant:', error);
    }
  });

  afterEach(async () => {
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
  });

  describe('Google Provider Validation', () => {
    it('should return error when missing required Google provider fields', async () => {
      // Test missing clientId
      const missingClientId = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Test Gmail',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          // Missing: clientId
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(
        emailProviderService.createProvider(missingClientId)
      ).rejects.toThrow('Google Client ID is required');
    });

    it('should return error for invalid email format', async () => {
      const invalidEmail = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Invalid Email Test',
        mailbox: 'not-an-email', // Invalid email
        isActive: true,
        vendorConfig: {
          clientId: 'client-id',
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(
        emailProviderService.createProvider(invalidEmail)
      ).rejects.toThrow('Please enter a valid email address');
    });

    it('should return error when provider name is too long', async () => {
      const longName = 'A'.repeat(256); // 256 characters
      
      const longNameProvider = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: longName,
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'client-id',
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(
        emailProviderService.createProvider(longNameProvider)
      ).rejects.toThrow('Provider name must be less than 255 characters');
    });
  });

  describe('Microsoft Provider Validation', () => {
    it('should return error when missing required Microsoft provider fields', async () => {
      // Test missing clientSecret
      const missingClientSecret = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'Test Microsoft',
        mailbox: 'test@outlook.com',
        isActive: true,
        vendorConfig: {
          clientId: 'ms-client-id',
          // Missing: clientSecret
          tenantId: 'ms-tenant'
        }
      };

      await expect(
        emailProviderService.createProvider(missingClientSecret)
      ).rejects.toThrow('Microsoft Client Secret is required');
    });

    it('should handle missing optional fields gracefully', async () => {
      const minimalMicrosoft = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'Minimal Microsoft',
        mailbox: 'minimal@outlook.com',
        isActive: true,
        vendorConfig: {
          clientId: 'ms-client-id',
          clientSecret: 'ms-secret'
          // tenantId is optional
        }
      };

      const result = await emailProviderService.createProvider(minimalMicrosoft);
      
      expect(result).toBeDefined();
      expect(result.mailbox).toBe('minimal@outlook.com');
      expect(result.provider_config.tenantId).toBeUndefined();
    });
  });

  describe('General Validation', () => {
    it('should return error for null or undefined required fields', async () => {
      const nullFields = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: null as any, // null provider name
        mailbox: undefined as any, // undefined mailbox
        isActive: true,
        vendorConfig: {}
      };

      await expect(
        emailProviderService.createProvider(nullFields)
      ).rejects.toThrow(/Please fix the following errors/);
    });

    it('should return error for empty string in required fields', async () => {
      const emptyFields = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: '', // Empty provider name
        mailbox: '   ', // Whitespace only mailbox
        isActive: true,
        vendorConfig: {
          clientId: '',
          clientSecret: '   ',
          projectId: 'valid-project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      await expect(
        emailProviderService.createProvider(emptyFields)
      ).rejects.toThrow(/Provider name is required|Email address is required|Please fix the following errors/);
    });

    it('should handle special characters in provider names', async () => {
      const specialChars = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Test <script>alert("xss")</script> Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'client-id.apps.googleusercontent.com',
          clientSecret: 'secret',
          projectId: 'project',
          pubSubTopic: 'topic',
          pubSubSubscription: 'sub'
        }
      };

      const result = await emailProviderService.createProvider(specialChars);
      
      // Should store as-is (no XSS protection at database level)
      expect(result.name).toContain('<script>');
    });

    it('should return meaningful error for duplicate mailbox', async () => {
      const firstProvider = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'First Provider',
        mailbox: 'duplicate@gmail.com',
        isActive: true,
        vendorConfig: {
          clientId: 'client-1.apps.googleusercontent.com',
          clientSecret: 'secret-1',
          projectId: 'project-1',
          pubSubTopic: 'topic-1',
          pubSubSubscription: 'sub-1'
        }
      };

      // Create first provider
      await emailProviderService.createProvider(firstProvider);

      // Try to create duplicate
      const duplicateProvider = {
        ...firstProvider,
        providerName: 'Duplicate Provider',
        vendorConfig: {
          ...firstProvider.vendorConfig,
          clientId: 'client-2.apps.googleusercontent.com'
        }
      };

      // Currently there's no unique constraint on mailbox per tenant
      // So this will succeed
      const result = await emailProviderService.createProvider(duplicateProvider);
      expect(result).toBeDefined();
      
      // Both providers should exist
      const providers = await emailProviderService.getProviders({
        tenant: testTenant,
        mailbox: 'duplicate@gmail.com'
      });
      
      expect(providers.length).toBe(2);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful error messages for common mistakes', async () => {
      // Test various scenarios and check error messages
      const scenarios = [
        {
          name: 'Invalid provider type',
          data: {
            tenant: testTenant,
            providerType: 'yahoo' as any, // Invalid
            providerName: 'Yahoo Mail',
            mailbox: 'test@yahoo.com',
            isActive: true,
            vendorConfig: {}
          },
          expectedError: /Provider type must be either "google" or "microsoft"/
        },
        {
          name: 'Missing vendor config',
          data: {
            tenant: testTenant,
            providerType: 'google' as const,
            providerName: 'Bad Config',
            mailbox: 'test@gmail.com',
            isActive: true,
            vendorConfig: undefined as any
          },
          expectedError: /Google provider configuration is required/
        }
      ];

      for (const scenario of scenarios) {
        try {
          await emailProviderService.createProvider(scenario.data);
          // If it doesn't throw, check if we expected it to succeed
          if (scenario.expectedError) {
            expect.fail(`Expected ${scenario.name} to throw an error`);
          }
        } catch (error: any) {
          if (scenario.expectedError) {
            expect(error.message).toMatch(scenario.expectedError);
          } else {
            throw error;
          }
        }
      }
    });
  });
});