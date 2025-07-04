/**
 * Minimal Project API test to verify basic functionality
 */

import { describe, it, expect } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';

const API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

describe('Project API - Minimal Test', () => {
  it('should create and list projects', async () => {
    // Setup test environment
    const setup = await withTestSetup();
    
    // First, create a company for the project
    const companyResponse = await fetch(`${API_BASE_URL}/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      },
      body: JSON.stringify({
        company_name: 'Test Company for Project',
        email: 'project-test@example.com',
        billing_cycle: 'monthly'
      })
    });
    
    console.log('Company creation:', companyResponse.status);
    if (!companyResponse.ok) {
      const error = await companyResponse.text();
      console.log('Company creation error:', error);
      throw new Error('Failed to create company');
    }
    
    const companyResult = await companyResponse.json();
    const companyId = companyResult.data?.company_id || companyResult.company_id;
    console.log('Created company:', companyId);
    
    // Test creating a project with minimal data
    const createResponse = await fetch(`${API_BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      },
      body: JSON.stringify({
        project_name: 'Test Project',
        company_id: companyId,
        description: 'A test project',
        start_date: new Date().toISOString(),
        end_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days from now
        // Not setting status - let the API handle it
      })
    });
    
    console.log('Create project response:', createResponse.status);
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log('Create project error:', error);
    }
    
    expect(createResponse.status).toBe(201);
    const createResult = await createResponse.json();
    console.log('Create result:', JSON.stringify(createResult, null, 2));
    
    // Test listing projects
    const listResponse = await fetch(`${API_BASE_URL}/projects`, {
      method: 'GET',
      headers: {
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      }
    });
    
    console.log('List projects response:', listResponse.status);
    expect(listResponse.status).toBe(200);
    const listResult = await listResponse.json();
    console.log('List result:', JSON.stringify(listResult, null, 2));
    
    // Should have at least the project we created
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);
    
    // Check if we created the project successfully
    if (createResult.data) {
      expect(createResult.data.project_name).toBe('Test Project');
      expect(createResult.data.company_id).toBe(companyId);
    }
  });
});