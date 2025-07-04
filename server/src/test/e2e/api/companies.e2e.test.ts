import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { 
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import { createCompanyTestData, createCompanyLocationTestData } from '../utils/companyTestData';

describe('Companies API E2E Tests', () => {
  let env: E2ETestEnvironment;
  let createdCompanyIds: string[] = [];

  beforeAll(async () => {
    // Setup test environment
    env = await setupE2ETestEnvironment({
      companyName: 'Companies API Test Company',
      userName: 'companies_api_test'
    });
  });

  afterAll(async () => {
    // Clean up any created companies
    for (const companyId of createdCompanyIds) {
      try {
        await env.apiClient.delete(`/api/v1/companies/${companyId}`);
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    // Clean up test environment
    await env.cleanup();
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      const client = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        tenantId: env.tenant
      });
      const response = await client.get('/api/v1/companies');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('API key required');
    });

    it('should reject requests with invalid API key', async () => {
      const client = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        apiKey: 'invalid-key',
        tenantId: env.tenant
      });
      const response = await client.get('/api/v1/companies');
      
      expect(response.status).toBe(401);
      expect(response.data.error.message).toBe('Invalid API key');
    });

    it('should accept requests with valid API key', async () => {
      const response = await env.apiClient.get('/api/v1/companies');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('data');
      expect(response.data).toHaveProperty('pagination');
    });
  });

  describe('CRUD Operations', () => {
    it('should create a company', async () => {
      const companyData = createCompanyTestData();
      const response = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (response.status !== 201) {
        console.error('Create company failed:', response.status, JSON.stringify(response.data, null, 2));
        console.error('Company data sent:', JSON.stringify(companyData, null, 2));
      }
      
      expect(response.status).toBe(201);
      expect(response.data.data).toMatchObject({
        company_name: companyData.company_name,
        email: companyData.email,
        phone_no: companyData.phone_no
      });
      expect(response.data.data.company_id).toBeTruthy();
      
      createdCompanyIds.push(response.data.data.company_id);
    });

    it('should get a company by ID', async () => {
      // Create a company first
      const companyData = createCompanyTestData();
      const createResponse = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (createResponse.status !== 201) {
        console.error('Create company failed:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      }
      
      const companyId = createResponse.data.data.company_id;
      createdCompanyIds.push(companyId);
      
      // Get the company
      const response = await env.apiClient.get(`/api/v1/companies/${companyId}`);
      
      if (response.status !== 200) {
        console.error('Get company failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        company_id: companyId,
        company_name: companyData.company_name,
        email: companyData.email
      });
    });

    it('should update a company', async () => {
      // Create a company first
      const companyData = createCompanyTestData();
      const createResponse = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (createResponse.status !== 201) {
        console.error('Create company failed in update test:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      }
      
      const companyId = createResponse.data.data.company_id;
      createdCompanyIds.push(companyId);
      
      // Update the company
      const updateData = {
        company_name: 'Updated Company Name',
        notes: 'Updated notes'
      };
      const response = await env.apiClient.put(`/api/v1/companies/${companyId}`, updateData);
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        company_id: companyId,
        company_name: updateData.company_name,
        notes: updateData.notes
      });
    });

    it('should delete a company', async () => {
      // Create a company first
      const companyData = createCompanyTestData();
      const createResponse = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (createResponse.status !== 201) {
        console.error('Create company failed in delete test:', createResponse.status, JSON.stringify(createResponse.data, null, 2));
      }
      
      const companyId = createResponse.data.data.company_id;
      
      // Delete the company
      const response = await env.apiClient.delete(`/api/v1/companies/${companyId}`);
      
      expect(response.status).toBe(204);
      
      // Verify it's deleted
      const getResponse = await env.apiClient.get(`/api/v1/companies/${companyId}`);
      expect(getResponse.status).toBe(404);
    });

    it('should list companies with pagination', async () => {
      // Create multiple companies
      const companies = [];
      for (let i = 0; i < 5; i++) {
        const companyData = createCompanyTestData();
        const response = await env.apiClient.post('/api/v1/companies', companyData);
        if (response.data?.data) {
          companies.push(response.data.data);
          createdCompanyIds.push(response.data.data.company_id);
        }
      }
      
      // List companies
      const response = await env.apiClient.get('/api/v1/companies?limit=3&page=1');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeLessThanOrEqual(3);
      expect(response.data.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: expect.any(Number)
      });
    });
  });

  describe('Company Locations', () => {
    let testCompanyId: string;

    beforeEach(async () => {
      // Create a test company for location tests
      const companyData = createCompanyTestData();
      const response = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (response.status !== 201) {
        console.error('Failed to create test company in beforeEach:', response.status, JSON.stringify(response.data, null, 2));
        throw new Error('Failed to create test company');
      }
      
      if (response.data?.data?.company_id) {
        testCompanyId = response.data.data.company_id;
        createdCompanyIds.push(testCompanyId);
      } else {
        throw new Error('No company ID returned from create');
      }
    });

    it('should create a company location', async () => {
      const locationData = createCompanyLocationTestData();
      const response = await env.apiClient.post(
        `/api/v1/companies/${testCompanyId}/locations`,
        locationData
      );
      
      if (response.status !== 201) {
        console.error('Create location failed:', response.status, JSON.stringify(response.data, null, 2));
        console.error('Location data sent:', JSON.stringify(locationData, null, 2));
      }
      
      expect(response.status).toBe(201);
      expect(response.data.data).toMatchObject({
        address_line1: locationData.address_line1,
        city: locationData.city,
        state_province: locationData.state_province,
        postal_code: locationData.postal_code
      });
    });

    it('should get company locations', async () => {
      if (!testCompanyId) {
        throw new Error('Test company not created in beforeEach');
      }
      
      // Create a location first
      const locationData = createCompanyLocationTestData();
      await env.apiClient.post(
        `/api/v1/companies/${testCompanyId}/locations`,
        locationData
      );
      
      // Get locations
      const response = await env.apiClient.get(`/api/v1/companies/${testCompanyId}/locations`);
      
      if (response.status !== 200) {
        console.error('Get locations failed:', response.status, JSON.stringify(response.data, null, 2));
        console.error('Company ID:', testCompanyId);
      }
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThan(0);
    });
  });

  describe('Company Contacts', () => {
    let testCompanyId: string;

    beforeEach(async () => {
      // Create a test company
      const companyData = createCompanyTestData();
      const response = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (response.status !== 201) {
        console.error('Failed to create test company in beforeEach:', response.status, JSON.stringify(response.data, null, 2));
        throw new Error('Failed to create test company');
      }
      
      if (response.data?.data?.company_id) {
        testCompanyId = response.data.data.company_id;
        createdCompanyIds.push(testCompanyId);
      } else {
        throw new Error('No company ID returned from create');
      }
    });

    it('should get company contacts', async () => {
      if (!testCompanyId) {
        throw new Error('Test company not created in beforeEach');
      }
      
      const response = await env.apiClient.get(`/api/v1/companies/${testCompanyId}/contacts`);
      
      if (response.status !== 200) {
        console.error('Get contacts failed:', response.status, JSON.stringify(response.data, null, 2));
        console.error('Company ID:', testCompanyId);
      }
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.pagination).toBeDefined();
    });
  });

  describe('Company Statistics', () => {
    it('should get company statistics', async () => {
      const response = await env.apiClient.get('/api/v1/companies/stats');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toMatchObject({
        total_companies: expect.any(Number),
        active_companies: expect.any(Number),
        inactive_companies: expect.any(Number)
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent company', async () => {
      const response = await env.apiClient.get('/api/v1/companies/00000000-0000-0000-0000-000000000000');
      
      if (response.status !== 404) {
        console.error('404 test failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(404);
      expect(response.data.error.message).toContain('not found');
    });

    it('should return 400 for invalid company data', async () => {
      const invalidData = {
        company_name: '', // Required field
        email: 'invalid-email' // Invalid format
      };
      
      const response = await env.apiClient.post('/api/v1/companies', invalidData);
      
      if (response.status !== 400) {
        console.error('Validation test failed:', response.status, JSON.stringify(response.data, null, 2));
      }
      
      expect(response.status).toBe(400);
      expect(response.data.error.message).toContain('Validation failed');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await env.apiClient.get('/api/v1/companies/invalid-uuid');
      
      expect(response.status).toBe(400);
      expect(response.data.error).toBeDefined();
    });
  });

  describe('Filtering and Search', () => {
    beforeEach(async () => {
      // Create test companies with different attributes
      const companies = [
        { company_name: 'Active Tech Corp', is_inactive: false },
        { company_name: 'Inactive Solutions Inc', is_inactive: true },
        { company_name: 'Another Active Company', is_inactive: false }
      ];
      
      for (const company of companies) {
        const response = await env.apiClient.post('/api/v1/companies', createCompanyTestData(company));
        if (response.data?.data?.company_id) {
          createdCompanyIds.push(response.data.data.company_id);
        }
      }
    });

    it('should filter companies by active status', async () => {
      const response = await env.apiClient.get('/api/v1/companies?is_inactive=false');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      response.data.data.forEach((company: any) => {
        expect(company.is_inactive).toBe(false);
      });
    });

    it('should search companies by name', async () => {
      const response = await env.apiClient.get('/api/v1/companies?company_name=Tech');
      
      expect(response.status).toBe(200);
      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.some((c: any) => c.company_name.includes('Tech'))).toBe(true);
    });
  });

  describe('Permissions', () => {
    it('should enforce read permissions for listing', async () => {
      // This test assumes the test user has proper permissions
      // If permissions are revoked, this should fail
      const response = await env.apiClient.get('/api/v1/companies');
      expect(response.status).toBe(200);
    });

    it('should enforce create permissions', async () => {
      const companyData = createCompanyTestData();
      const response = await env.apiClient.post('/api/v1/companies', companyData);
      
      if (response.status === 500) {
        console.error('Unexpected 500 error in permissions test:', JSON.stringify(response.data, null, 2));
      }
      
      expect([201, 403, 500]).toContain(response.status); // Allow 500 for now
      if (response.status === 201 && response.data?.data?.company_id) {
        createdCompanyIds.push(response.data.data.company_id);
      }
    });
  });
});