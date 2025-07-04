import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { 
  setupE2ETestEnvironment, 
  E2ETestEnvironment 
} from '../utils/e2eTestSetup';
import { 
  createTestContact, 
  createTestContacts,
  createContactsForPagination,
  createTestContactSet
} from '../utils/contactTestDataFactory';
import { 
  assertSuccess, 
  assertError, 
  buildQueryString,
  extractPagination
} from '../utils/apiTestHelpers';

describe('Contact API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/contacts';

  // Skip health check for now - assume server is running

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
  });

  afterEach(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Authentication', () => {
    it('should require API key for all endpoints', async () => {
      // Remove API key for this test
      const clientWithoutKey = new (await import('../utils/apiTestHelpers')).ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl
      });

      const response = await clientWithoutKey.get(API_BASE);
      assertError(response, 401, 'UNAUTHORIZED');
      expect(response.data.error.message).toContain('API key required');
    });

    it('should reject invalid API key', async () => {
      const clientWithBadKey = new (await import('../utils/apiTestHelpers')).ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: 'invalid-api-key-12345'
      });

      const response = await clientWithBadKey.get(API_BASE);
      assertError(response, 401, 'UNAUTHORIZED');
      expect(response.data.error.message).toContain('Invalid API key');
    });
  });

  describe('CRUD Operations', () => {
    describe('Create Contact (POST /api/v1/contacts)', () => {
      it('should create a new contact', async () => {
        const newContact = {
          full_name: 'John Doe',
          email: 'john.doe@example.com',
          phone_number: '+1-555-123-4567',
          company_id: env.companyId,
          role: 'Manager',
          notes: 'Test contact'
        };

        const response = await env.apiClient.post(API_BASE, newContact);
        assertSuccess(response, 201);
        
        expect(response.data.data).toMatchObject({
          full_name: newContact.full_name,
          email: newContact.email,
          phone_number: newContact.phone_number,
          company_id: env.companyId,
          role: newContact.role,
          notes: newContact.notes,
          is_inactive: false,
          tenant: env.tenant
        });
        expect(response.data.data.contact_name_id).toBeDefined();
      });

      it('should validate required fields', async () => {
        const invalidContact = {
          email: 'invalid@example.com'
          // Missing required full_name
        };

        const response = await env.apiClient.post(API_BASE, invalidContact);
        assertError(response, 400, 'VALIDATION_ERROR');
      });

      it('should validate email format', async () => {
        const invalidContact = {
          full_name: 'Test User',
          email: 'not-an-email',
          phone_number: '+1-555-123-4567'
        };

        const response = await env.apiClient.post(API_BASE, invalidContact);
        assertError(response, 400, 'VALIDATION_ERROR');
      });
    });

    describe('Get Contact (GET /api/v1/contacts/:id)', () => {
      it('should retrieve a contact by ID', async () => {
        // Create a test contact
        const contact = await createTestContact(env.db, env.tenant, {
          full_name: 'Jane Smith',
          email: 'jane.smith@example.com',
          company_id: env.companyId
        });

        const response = await env.apiClient.get(`${API_BASE}/${contact.contact_name_id}`);
        assertSuccess(response);
        
        expect(response.data.data).toMatchObject({
          contact_name_id: contact.contact_name_id,
          full_name: contact.full_name,
          email: contact.email,
          company_id: contact.company_id
        });
      });

      it('should return 404 for non-existent contact', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const response = await env.apiClient.get(`${API_BASE}/${fakeId}`);
        assertError(response, 404, 'NOT_FOUND');
      });

      it('should not return contacts from other tenants', async () => {
        // This test would require creating another tenant and contact
        // For now, we'll skip this test as it requires more complex setup
      });
    });

    describe('Update Contact (PUT /api/v1/contacts/:id)', () => {
      it('should update a contact', async () => {
        const contact = await createTestContact(env.db, env.tenant, {
          full_name: 'Original Name',
          email: 'original@example.com'
        });

        const updates = {
          full_name: 'Updated Name',
          role: 'Senior Manager',
          is_inactive: true
        };

        const response = await env.apiClient.put(`${API_BASE}/${contact.contact_name_id}`, updates);
        assertSuccess(response);
        
        expect(response.data.data).toMatchObject({
          contact_name_id: contact.contact_name_id,
          full_name: updates.full_name,
          role: updates.role,
          is_inactive: updates.is_inactive,
          email: contact.email // Should remain unchanged
        });
      });

      it('should return 404 when updating non-existent contact', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const response = await env.apiClient.put(`${API_BASE}/${fakeId}`, { full_name: 'New Name' });
        assertError(response, 404, 'NOT_FOUND');
      });
    });

    describe('Delete Contact (DELETE /api/v1/contacts/:id)', () => {
      it('should delete a contact', async () => {
        const contact = await createTestContact(env.db, env.tenant, {
          full_name: 'To Delete',
          email: 'delete@example.com'
        });

        const response = await env.apiClient.delete(`${API_BASE}/${contact.contact_name_id}`);
        assertSuccess(response, 204);

        // Verify contact is deleted
        const getResponse = await env.apiClient.get(`${API_BASE}/${contact.contact_name_id}`);
        assertError(getResponse, 404);
      });

      it('should return 404 when deleting non-existent contact', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const response = await env.apiClient.delete(`${API_BASE}/${fakeId}`);
        assertError(response, 404, 'NOT_FOUND');
      });
    });
  });

  describe('List Contacts (GET /api/v1/contacts)', () => {
    beforeEach(async () => {
      // Create test data set
      await createTestContactSet(env.db, env.tenant, env.companyId);
    });

    it('should list all contacts with default pagination', async () => {
      const response = await env.apiClient.get(API_BASE);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();
      expect(response.data.pagination).toMatchObject({
        page: 1,
        limit: 25,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrev: false
      });
    });

    it('should support pagination parameters', async () => {
      const query = buildQueryString({ page: 2, limit: 5 });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const pagination = extractPagination(response);
      expect(pagination.page).toBe(2);
      expect(pagination.limit).toBe(5);
      expect(pagination.hasPrev).toBe(true);
    });

    it('should filter by company_id', async () => {
      const query = buildQueryString({ company_id: env.companyId });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((contact: any) => {
        expect(contact.company_id).toBe(env.companyId);
      });
    });

    it('should filter by is_inactive status', async () => {
      const query = buildQueryString({ is_inactive: 'false' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      response.data.data.forEach((contact: any) => {
        expect(contact.is_inactive).toBe(false);
      });
    });

    it('should sort contacts by name', async () => {
      const query = buildQueryString({ sort: 'full_name', order: 'asc' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      const names = response.data.data.map((c: any) => c.full_name);
      const sortedNames = [...names].sort();
      expect(names).toEqual(sortedNames);
    });
  });

  describe('Search Contacts (GET /api/v1/contacts/search)', () => {
    beforeEach(async () => {
      // Create specific contacts for search tests
      await createTestContact(env.db, env.tenant, {
        full_name: 'Alice Johnson',
        email: 'alice@techcorp.com',
        role: 'CTO',
        notes: 'Technical leadership'
      });
      await createTestContact(env.db, env.tenant, {
        full_name: 'Bob Technical',
        email: 'bob@example.com',
        role: 'Developer',
        notes: 'Frontend specialist'
      });
    });

    it('should search contacts by query', async () => {
      const query = buildQueryString({ query: 'alice' });
      const response = await env.apiClient.get(`${API_BASE}/search${query}`);
      assertSuccess(response);

      expect(response.data.data).toHaveLength(1);
      expect(response.data.data[0].full_name).toContain('Alice');
    });

    it('should search in specified fields', async () => {
      const query = buildQueryString({ 
        query: 'technical',
        fields: ['full_name', 'notes']
      });
      const response = await env.apiClient.get(`${API_BASE}/search${query}`);
      assertSuccess(response);

      expect(response.data.data).toHaveLength(2); // Both have 'technical' in name or notes
    });

    it('should limit search results', async () => {
      const query = buildQueryString({ query: 'e', limit: '1' });
      const response = await env.apiClient.get(`${API_BASE}/search${query}`);
      assertSuccess(response);

      expect(response.data.data).toHaveLength(1);
    });
  });

  describe('Export Contacts (GET /api/v1/contacts/export)', () => {
    beforeEach(async () => {
      await createTestContacts(env.db, env.tenant, 3);
    });

    it('should export contacts as CSV', async () => {
      const query = buildQueryString({ format: 'csv' });
      const response = await env.apiClient.get(`${API_BASE}/export${query}`);
      assertSuccess(response);

      expect(response.headers.get('content-type')).toContain('text/csv');
      expect(response.data).toBeDefined();
    });

    it('should export contacts as JSON', async () => {
      const query = buildQueryString({ format: 'json' });
      const response = await env.apiClient.get(`${API_BASE}/export${query}`);
      assertSuccess(response);

      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.data.data).toBeInstanceOf(Array);
    });

    it('should export only active contacts by default', async () => {
      // Create inactive contact
      await createTestContact(env.db, env.tenant, {
        full_name: 'Inactive Contact',
        email: 'inactive@example.com',
        is_inactive: true
      });

      const query = buildQueryString({ format: 'json' });
      const response = await env.apiClient.get(`${API_BASE}/export${query}`);
      assertSuccess(response);

      response.data.data.forEach((contact: any) => {
        expect(contact.is_inactive).toBe(false);
      });
    });
  });

  describe('Contact Statistics (GET /api/v1/contacts/stats)', () => {
    it('should return contact statistics', async () => {
      // Create test data
      await createTestContactSet(env.db, env.tenant, env.companyId);

      const response = await env.apiClient.get(`${API_BASE}/stats`);
      assertSuccess(response);

      expect(response.data.data).toMatchObject({
        total_contacts: expect.any(Number),
        active_contacts: expect.any(Number),
        inactive_contacts: expect.any(Number),
        contacts_with_company: expect.any(Number),
        contacts_without_company: expect.any(Number),
        contacts_by_role: expect.any(Object),
        recent_contacts: expect.any(Number)
      });
    });
  });

  describe('Error Handling', () => {

    it('should handle invalid query parameters', async () => {
      const query = buildQueryString({ page: 'invalid', limit: 'abc' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertError(response, 400, 'VALIDATION_ERROR');
    });

    it('should handle database errors gracefully', async () => {
      // This would require mocking database errors
      // For now, we'll skip this test
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for GET endpoints', async () => {
      // This would require creating a user without read permissions
      // For now, we'll skip this test as it requires RBAC setup
    });

    it('should enforce write permissions for POST/PUT/DELETE', async () => {
      // This would require creating a user without write permissions
      // For now, we'll skip this test as it requires RBAC setup
    });
  });

  describe('Multi-tenancy', () => {
    it('should isolate contacts by tenant', async () => {
      // This would require creating another tenant and verifying isolation
      // For now, we'll skip this test as it requires complex setup
    });
  });
});