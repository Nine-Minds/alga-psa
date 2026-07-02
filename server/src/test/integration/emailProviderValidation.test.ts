/**
 * Integration tests for email provider validation and error messages
 * Ensures that reasonable error messages are returned when required fields are missing
 *
 * The user-friendly messages live in EmailProviderValidator; EmailProviderService
 * itself persists to the current split schema (email_providers + per-vendor
 * snake_case config tables), which is exercised by the DB-backed tests below.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';
import { EmailProviderValidator } from '../../services/email/EmailProviderValidator';

// Global test variables
let testDb: Knex;
let testTenant: string;
let emailProviderService: EmailProviderService;

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Email provider validation test fixture creates and removes tenant rows'
  );
}

function validationMessages(data: any): string[] {
  return EmailProviderValidator.validateCreateProvider(data).map((e) => e.message);
}

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
      await tenantFixtureTable().insert({
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
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();

      await tenantFixtureTable()
        .where('tenant', testTenant)
        .delete();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Google Provider Validation', () => {
    it('should return error when missing required Google provider fields', () => {
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

      expect(validationMessages(missingClientId)).toContain('Google Client ID is required');
    });

    it('should return error for invalid email format', () => {
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

      expect(validationMessages(invalidEmail)).toContain('Please enter a valid email address');
    });

    it('should return error when provider name is too long', () => {
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

      expect(validationMessages(longNameProvider)).toContain('Provider name must be less than 255 characters');
    });
  });

  describe('Microsoft Provider Validation', () => {
    it('should return error when missing required Microsoft provider fields', () => {
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

      expect(validationMessages(missingClientSecret)).toContain('Microsoft Client Secret is required');
    });

    it('should handle missing optional fields gracefully', async () => {
      const minimalMicrosoft = {
        tenant: testTenant,
        providerType: 'microsoft' as const,
        providerName: 'Minimal Microsoft',
        mailbox: 'minimal@outlook.com',
        isActive: true,
        vendorConfig: {
          client_id: 'ms-client-id',
          client_secret: 'ms-secret',
          tenant_id: 'common',
          redirect_uri: 'http://localhost:3000/api/auth/microsoft/callback'
          // OAuth tokens are optional
        }
      };

      const result = await emailProviderService.createProvider(minimalMicrosoft);

      expect(result).toBeDefined();
      expect(result.mailbox).toBe('minimal@outlook.com');
      expect(result.provider_config.access_token).toBeNull();
      expect(result.provider_config.refresh_token).toBeNull();
    });
  });

  describe('General Validation', () => {
    it('should return error for null or undefined required fields', () => {
      const nullFields = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: null as any, // null provider name
        mailbox: undefined as any, // undefined mailbox
        isActive: true,
        vendorConfig: {}
      };

      const errors = EmailProviderValidator.validateCreateProvider(nullFields);
      expect(EmailProviderValidator.formatValidationErrors(errors)).toMatch(/Please fix the following errors/);
    });

    it('should return error for empty string in required fields', () => {
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

      const messages = validationMessages(emptyFields);
      expect(messages).toContain('Provider name is required');
      expect(messages).toContain('Email address is required');
    });

    it('should handle special characters in provider names', async () => {
      const specialChars = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Test <script>alert("xss")</script> Provider',
        mailbox: 'test@gmail.com',
        isActive: true,
        vendorConfig: {
          client_id: 'client-id.apps.googleusercontent.com',
          client_secret: 'secret',
          project_id: 'project',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'topic',
          pubsub_subscription_name: 'sub'
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
          client_id: 'client-1.apps.googleusercontent.com',
          client_secret: 'secret-1',
          project_id: 'project-1',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'topic-1',
          pubsub_subscription_name: 'sub-1'
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
          client_id: 'client-2.apps.googleusercontent.com'
        }
      };

      // email_providers has a unique (tenant, mailbox) constraint
      await expect(
        emailProviderService.createProvider(duplicateProvider)
      ).rejects.toThrow(/Failed to create email provider/);

      const providers = await emailProviderService.getProviders({
        tenant: testTenant,
        mailbox: 'duplicate@gmail.com'
      });

      expect(providers.length).toBe(1);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful error messages for common mistakes', () => {
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
          expectedError: /Provider type must be either "google", "microsoft", or "imap"/
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
        const errors = EmailProviderValidator.validateCreateProvider(scenario.data);
        expect(errors.length, `Expected ${scenario.name} to produce validation errors`).toBeGreaterThan(0);
        expect(EmailProviderValidator.formatValidationErrors(errors)).toMatch(scenario.expectedError);
      }
    });
  });
});
