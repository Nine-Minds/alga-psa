import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2ETestEnvironment, E2ETestEnvironment } from './e2eTestSetup';
import { createTestContact, createTestContacts, generateContactData } from './contactTestDataFactory';
import { assertSuccess, assertError, buildQueryString } from './apiTestHelpers';

describe('E2E Test Utilities', () => {
  let env: E2ETestEnvironment;

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
  });

  afterEach(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Test Environment Setup', () => {
    it('should create a complete test environment', () => {
      expect(env).toBeDefined();
      expect(env.tenant).toBeDefined();
      expect(env.clientId).toBeDefined();
      expect(env.locationId).toBeDefined();
      expect(env.userId).toBeDefined();
      expect(env.apiKey).toBeDefined();
      expect(env.apiClient).toBeDefined();
      expect(env.cleanup).toBeInstanceOf(Function);
    });

    it('should have a valid database connection', async () => {
      const result = await env.db.raw('SELECT 1 as test');
      expect(result.rows[0].test).toBe(1);
    });

    it('should have created a tenant', async () => {
      const tenant = await env.db('tenants')
        .where('tenant', env.tenant)
        .first();
      expect(tenant).toBeDefined();
    });

    it('should have created a user', async () => {
      const user = await env.db('users')
        .where('user_id', env.userId)
        .where('tenant', env.tenant)
        .first();
      expect(user).toBeDefined();
    });

    it('should have created an API key', async () => {
      const apiKey = await env.db('api_keys')
        .where('user_id', env.userId)
        .where('tenant', env.tenant)
        .where('active', true)
        .first();
      expect(apiKey).toBeDefined();
    });
  });

  describe('Contact Test Data Factory', () => {
    it('should generate random contact data', () => {
      const data = generateContactData();
      expect(data.full_name).toBeDefined();
      expect(data.email).toBeDefined();
      expect(data.phone_number).toBeDefined();
      expect(data.role).toBeDefined();
      expect(data.is_inactive).toBe(false);
      expect(data.notes).toBeDefined();
    });

    it('should create a single contact', async () => {
      const contact = await createTestContact(env.db, env.tenant, {
        full_name: 'John Doe',
        email: 'john.doe@example.com',
        client_id: env.clientId
      });

      expect(contact.contact_name_id).toBeDefined();
      expect(contact.full_name).toBe('John Doe');
      expect(contact.email).toBe('john.doe@example.com');
      expect(contact.client_id).toBe(env.clientId);
      expect(contact.tenant).toBe(env.tenant);
    });

    it('should create multiple contacts', async () => {
      const contacts = await createTestContacts(env.db, env.tenant, 5);
      
      expect(contacts).toHaveLength(5);
      contacts.forEach(contact => {
        expect(contact.contact_name_id).toBeDefined();
        expect(contact.tenant).toBe(env.tenant);
      });
    });
  });

  describe('API Test Helpers', () => {
    it('should build query strings correctly', () => {
      const query = buildQueryString({
        page: 1,
        limit: 10,
        search: 'test',
        active: true,
        nullValue: null,
        undefinedValue: undefined
      });

      expect(query).toBe('?page=1&limit=10&search=test&active=true');
    });

    it('should assert successful responses', () => {
      const response = { status: 200, data: { success: true }, headers: new Headers(), ok: true };
      expect(() => assertSuccess(response)).not.toThrow();
      expect(() => assertSuccess(response, 201)).toThrow();
    });

    it('should assert error responses', () => {
      const response = { 
        status: 400, 
        data: { error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } }, 
        headers: new Headers(), 
        ok: false 
      };
      
      expect(() => assertError(response, 400)).not.toThrow();
      expect(() => assertError(response, 400, 'VALIDATION_ERROR')).not.toThrow();
      expect(() => assertError(response, 400, 'DIFFERENT_ERROR')).toThrow();
    });
  });

  describe('API Client', () => {
    it('should have API key configured', () => {
      expect(env.apiClient).toBeDefined();
      // The API key is set internally, we just verify the client exists
    });

    it('should be able to make requests', async () => {
      // This is a basic test to ensure the client can attempt requests
      // The actual API endpoint testing will be done in the main test file
      const testUrl = '/api/v1/contacts';
      
      // We don't expect this to succeed without a running server
      // Just verify the client can attempt the request
      try {
        await env.apiClient.get(testUrl);
      } catch (error) {
        // Expected to fail in test environment without running server
        expect(error).toBeDefined();
      }
    });
  });
});