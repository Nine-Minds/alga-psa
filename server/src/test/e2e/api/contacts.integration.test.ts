import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestEnvironment } from '../../../../test-utils/testDataFactory';
import { createTestApiKey } from '../utils/apiTestHelpers';
import { createTestContact, createTestContacts } from '../utils/contactTestDataFactory';
import { ContactController } from '../../../lib/api/controllers/ContactController';

// Mock the authentication middleware to use our test API key
vi.mock('../../../lib/api/middleware/apiMiddleware', async () => {
  const actual = await vi.importActual('../../../lib/api/middleware/apiMiddleware');
  return {
    ...actual,
    withAuth: (handler: Function) => handler,
    withPermission: (resource: string, action: string) => (handler: Function) => handler,
  };
});

describe('Contact API Integration Tests', () => {
  let db: any;
  let controller: ContactController;
  let testEnv: any;
  let apiKey: string;

  beforeEach(async () => {
    db = await createTestDbConnection();
    controller = new ContactController();
    testEnv = await createTestEnvironment(db);
    const apiKeyRecord = await createTestApiKey(db, testEnv.userId, testEnv.tenantId);
    apiKey = apiKeyRecord.api_key;
  });

  afterEach(async () => {
    if (db) {
      // Clean up test data
      await db('contacts').where('tenant', testEnv.tenantId).delete();
      await db('api_keys').where('tenant', testEnv.tenantId).delete();
      await db('users').where('tenant', testEnv.tenantId).delete();
      await db('companies').where('tenant', testEnv.tenantId).delete();
      await db('tenants').where('tenant', testEnv.tenantId).delete();
      await db.destroy();
    }
  });

  const createMockRequest = (options: {
    method?: string;
    url: string;
    body?: any;
    headers?: Record<string, string>;
  }) => {
    const url = new URL(options.url, 'http://localhost:3000');
    const headers = new Headers(options.headers || {});
    headers.set('x-api-key', apiKey);
    
    const request = {
      method: options.method || 'GET',
      url: url.toString(),
      headers,
      json: async () => options.body,
      text: async () => JSON.stringify(options.body),
      nextUrl: url,
      context: {
        userId: testEnv.userId,
        tenant: testEnv.tenantId,
        user: { user_id: testEnv.userId, tenant: testEnv.tenantId }
      }
    } as any;

    return request;
  };

  describe('List Contacts', () => {
    it('should list contacts with pagination', async () => {
      // Create test contacts
      await createTestContacts(db, testEnv.tenantId, 5);

      const request = createMockRequest({
        url: '/api/v1/contacts?page=1&limit=3'
      });

      const response = await controller.list()(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(3);
      expect(data.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: 5,
        totalPages: 2,
        hasNext: true,
        hasPrev: false
      });
    });

    it('should filter contacts by company', async () => {
      // Create contacts with and without company
      await createTestContact(db, testEnv.tenantId, { 
        company_id: testEnv.companyId,
        full_name: 'With Company'
      });
      await createTestContact(db, testEnv.tenantId, { 
        company_id: null,
        full_name: 'Without Company'
      });

      const request = createMockRequest({
        url: `/api/v1/contacts?company_id=${testEnv.companyId}`
      });

      const response = await controller.list()(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].full_name).toBe('With Company');
    });
  });

  describe('Create Contact', () => {
    it('should create a new contact', async () => {
      const newContact = {
        full_name: 'John Doe',
        email: 'john.doe@example.com',
        phone_number: '+1-555-123-4567',
        company_id: testEnv.companyId,
        role: 'Manager'
      };

      const request = createMockRequest({
        method: 'POST',
        url: '/api/v1/contacts',
        body: newContact
      });

      const response = await controller.create()(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data).toMatchObject({
        full_name: newContact.full_name,
        email: newContact.email,
        phone_number: newContact.phone_number,
        company_id: testEnv.companyId,
        role: newContact.role,
        tenant: testEnv.tenantId
      });
    });

    it('should validate required fields', async () => {
      const invalidContact = {
        email: 'test@example.com'
        // Missing required full_name
      };

      const request = createMockRequest({
        method: 'POST',
        url: '/api/v1/contacts',
        body: invalidContact
      });

      const response = await controller.create()(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Get Contact', () => {
    it('should retrieve a contact by ID', async () => {
      const contact = await createTestContact(db, testEnv.tenantId, {
        full_name: 'Jane Smith',
        email: 'jane@example.com'
      });

      const request = createMockRequest({
        url: `/api/v1/contacts/${contact.contact_name_id}`
      });

      const response = await controller.get()(request, { id: contact.contact_name_id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toMatchObject({
        contact_name_id: contact.contact_name_id,
        full_name: contact.full_name,
        email: contact.email
      });
    });

    it('should return 404 for non-existent contact', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';

      const request = createMockRequest({
        url: `/api/v1/contacts/${fakeId}`
      });

      const response = await controller.get()(request, { id: fakeId });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Update Contact', () => {
    it('should update a contact', async () => {
      const contact = await createTestContact(db, testEnv.tenantId, {
        full_name: 'Original Name',
        email: 'original@example.com'
      });

      const updates = {
        full_name: 'Updated Name',
        role: 'Senior Manager'
      };

      const request = createMockRequest({
        method: 'PUT',
        url: `/api/v1/contacts/${contact.contact_name_id}`,
        body: updates
      });

      const response = await controller.update()(request, { id: contact.contact_name_id });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toMatchObject({
        contact_name_id: contact.contact_name_id,
        full_name: updates.full_name,
        role: updates.role,
        email: contact.email // Should remain unchanged
      });
    });
  });

  describe('Delete Contact', () => {
    it('should delete a contact', async () => {
      const contact = await createTestContact(db, testEnv.tenantId, {
        full_name: 'To Delete',
        email: 'delete@example.com'
      });

      const request = createMockRequest({
        method: 'DELETE',
        url: `/api/v1/contacts/${contact.contact_name_id}`
      });

      const response = await controller.delete()(request, { id: contact.contact_name_id });
      
      expect(response.status).toBe(204);

      // Verify contact is deleted
      const deleted = await db('contacts')
        .where('contact_name_id', contact.contact_name_id)
        .where('tenant', testEnv.tenantId)
        .first();
      
      expect(deleted).toBeUndefined();
    });
  });

  describe('Search Contacts', () => {
    it('should search contacts by query', async () => {
      await createTestContact(db, testEnv.tenantId, {
        full_name: 'Alice Johnson',
        email: 'alice@example.com'
      });
      await createTestContact(db, testEnv.tenantId, {
        full_name: 'Bob Smith',
        email: 'bob@example.com'
      });

      const request = createMockRequest({
        url: '/api/v1/contacts/search?query=alice'
      });

      const response = await controller.search()(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].full_name).toContain('Alice');
    });
  });

  describe('Contact Statistics', () => {
    it('should return contact statistics', async () => {
      // Create various contacts
      await createTestContacts(db, testEnv.tenantId, 3, { is_inactive: false });
      await createTestContacts(db, testEnv.tenantId, 2, { is_inactive: true });

      const request = createMockRequest({
        url: '/api/v1/contacts/stats'
      });

      const response = await controller.stats()(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toMatchObject({
        total_contacts: 5,
        active_contacts: 3,
        inactive_contacts: 2,
        contacts_with_company: expect.any(Number),
        contacts_without_company: expect.any(Number),
        recent_contacts: expect.any(Number)
      });
    });
  });
});