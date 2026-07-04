/**
 * Integration tests demonstrating reasonable error messages for email provider validation
 *
 * The user-friendly messages live in EmailProviderValidator; the happy path is
 * exercised against EmailProviderService with the current split schema
 * (email_providers + snake_case vendor config tables).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { EmailProviderService } from '../../services/email/EmailProviderService';
import { EmailProviderValidator } from '../../services/email/EmailProviderValidator';

let testDb: Knex;
let testTenant: string;
let emailProviderService: EmailProviderService;

function tenantTable<Row extends object = Record<string, unknown>>(table: string) {
  return tenantDb(testDb, testTenant).table<Row>(table);
}

function tenantFixtureTable() {
  return tenantDb(testDb, testTenant).unscoped(
    'tenants',
    'Email provider error messages test fixture creates and removes tenant rows'
  );
}

function formattedValidationError(data: any): string {
  return EmailProviderValidator.formatValidationErrors(
    EmailProviderValidator.validateCreateProvider(data)
  );
}

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

    // Create tenant record
    try {
      await tenantFixtureTable().insert({
        tenant: testTenant,
        client_name: 'Error Test Client',
        email: 'error-test@client.com',
        created_at: new Date(),
        updated_at: new Date()
      });
    } catch (error) {
      console.error('Failed to create test tenant:', error);
    }
  });

  afterAll(async () => {
    try {
      await tenantTable('google_email_provider_config').delete();
      await tenantTable('microsoft_email_provider_config').delete();
      await tenantTable('email_providers').delete();
      await tenantFixtureTable().where('tenant', testTenant).delete();
    } catch (error) {
      // Ignore cleanup errors
    }

    if (testDb) {
      await testDb.destroy();
    }
  });

  describe('User-Friendly Error Messages', () => {
    it('should return clear error when provider name is missing', () => {
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

      expect(formattedValidationError(config)).toContain('Provider name is required');
    });

    it('should return clear error when email is invalid', () => {
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

      expect(formattedValidationError(config)).toContain('Please enter a valid email address');
    });

    it('should return clear error when Google Client ID is missing', () => {
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

      expect(formattedValidationError(config)).toContain('Google Client ID is required');
    });

    it('should return multiple errors in a clear format', () => {
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

      expect(formattedValidationError(config)).toMatch(
        /Please fix the following errors:[\s\S]*Provider name is required[\s\S]*Please enter a valid email address[\s\S]*Google Client ID is required/
      );
    });

    it('should return helpful error for invalid provider type', () => {
      const config = {
        tenant: testTenant,
        providerType: 'yahoo' as any,  // Invalid type
        providerName: 'Yahoo Mail',
        mailbox: 'test@yahoo.com',
        isActive: true,
        vendorConfig: {}
      };

      expect(formattedValidationError(config)).toContain(
        'Provider type must be either "google", "microsoft", or "imap"'
      );
    });

    it('should return clear error for provider name that is too long', () => {
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

      expect(formattedValidationError(config)).toContain('Provider name must be less than 255 characters');
    });

    it('should return helpful error for invalid Microsoft tenant ID', () => {
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

      expect(formattedValidationError(config)).toContain(
        'Tenant ID must be "common", "organizations", "consumers", or a valid GUID'
      );
    });

    it('should return clear error for invalid max emails per sync', () => {
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

      expect(formattedValidationError(config)).toContain('Max emails per sync must be between 1 and 1000');
    });

    it('should return helpful hint for Google Client ID format', () => {
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

      expect(formattedValidationError(config)).toContain(
        'Google Client ID should end with ".apps.googleusercontent.com"'
      );
    });

    it('should successfully create provider when all fields are valid', async () => {
      const config = {
        tenant: testTenant,
        providerType: 'google' as const,
        providerName: 'Valid Google Provider',
        mailbox: 'valid@gmail.com',
        isActive: true,
        vendorConfig: {
          client_id: 'valid-client.apps.googleusercontent.com',
          client_secret: 'valid-secret',
          project_id: 'valid-project',
          redirect_uri: 'http://localhost:3000/api/auth/google/callback',
          pubsub_topic_name: 'valid-topic',
          pubsub_subscription_name: 'valid-sub'
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
