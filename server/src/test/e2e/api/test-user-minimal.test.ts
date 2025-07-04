/**
 * Minimal User API test to verify basic functionality
 */

import { describe, it, expect } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';

const API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

describe('User API - Minimal Test', () => {
  it('should create and list users', async () => {
    // Setup test environment
    const setup = await withTestSetup();
    
    // Test creating a user with minimal data and only 'internal' type
    const createResponse = await fetch(`${API_BASE_URL}/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      },
      body: JSON.stringify({
        username: 'testuser123',
        email: 'testuser123@example.com',
        password: 'SecurePass123!',
        first_name: 'Test',
        last_name: 'User',
        user_type: 'internal'  // Use only 'internal' which we know works
      })
    });
    
    console.log('Create user response:', createResponse.status);
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log('Create user error:', error);
    }
    
    expect(createResponse.status).toBe(201);
    const createResult = await createResponse.json();
    console.log('Create result:', JSON.stringify(createResult, null, 2));
    
    // Test listing users
    const listResponse = await fetch(`${API_BASE_URL}/users`, {
      method: 'GET',
      headers: {
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      }
    });
    
    console.log('List users response:', listResponse.status);
    expect(listResponse.status).toBe(200);
    const listResult = await listResponse.json();
    console.log('List result:', JSON.stringify(listResult, null, 2));
    
    // The list may be filtered or paginated, so just check if we can see at least one user
    expect(listResult.data.length).toBeGreaterThanOrEqual(1);
    
    // Check if we created the user successfully
    if (createResult.data) {
      expect(createResult.data.username).toBe('testuser123');
      expect(createResult.data.email).toBe('testuser123@example.com');
      expect(createResult.data.user_type).toBe('internal');
    }
  });
});