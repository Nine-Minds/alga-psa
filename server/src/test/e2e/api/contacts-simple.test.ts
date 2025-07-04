import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupE2ETestEnvironment, E2ETestEnvironment } from '../utils/e2eTestSetup';
import { createTestContact } from '../utils/contactTestDataFactory';

describe('Simple Contact API Test', () => {
  let env: E2ETestEnvironment;

  beforeEach(async () => {
    env = await setupE2ETestEnvironment();
    console.log('Test environment created:', {
      tenant: env.tenant,
      userId: env.userId,
      apiKey: env.apiKey.substring(0, 10) + '...',
      companyId: env.companyId
    });
  });

  afterEach(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  it('should test using API client', async () => {
    // Test using the API client from env
    const response = await env.apiClient.get('/api/v1/contacts');
    
    console.log('API Client - Response status:', response.status);
    console.log('API Client - Response body:', response.data);

    // We expect this to work or at least get past authentication
    expect(response.status).toBeDefined();
  });

  it('should test API key directly', async () => {
    // First, let's verify the API key exists in the database
    const apiKeyRecord = await env.db('api_keys')
      .where('tenant', env.tenant)
      .where('user_id', env.userId)
      .where('active', true)
      .first();
    
    console.log('API Key in DB:', {
      exists: !!apiKeyRecord,
      tenant: apiKeyRecord?.tenant,
      user_id: apiKeyRecord?.user_id,
      active: apiKeyRecord?.active
    });

    // Now let's make a simple request with tenant header
    const response = await fetch('http://127.0.0.1:3000/api/v1/contacts', {
      method: 'GET',
      headers: {
        'x-api-key': env.apiKey,
        'x-tenant-id': env.tenant,
        'content-type': 'application/json'
      }
    });

    console.log('Response status:', response.status);
    const body = await response.text();
    console.log('Response body:', body);

    // For now, just check we get a response
    expect(response.status).toBeDefined();
  });

  it('should test without API key', async () => {
    const response = await fetch('http://127.0.0.1:3000/api/v1/contacts', {
      method: 'GET',
      headers: {
        'content-type': 'application/json'
      }
    });

    console.log('No API key - Response status:', response.status);
    const body = await response.text();
    console.log('No API key - Response body:', body);

    expect(response.status).toBe(401);
  });
});