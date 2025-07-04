/**
 * Minimal Teams API test to verify basic functionality
 */

import { describe, it, expect } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';

const API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

describe('Teams API - Minimal Test', () => {
  it('should create and list teams', async () => {
    // Setup test environment
    const setup = await withTestSetup();
    
    // Test creating a team
    const createResponse = await fetch(`${API_BASE_URL}/teams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      },
      body: JSON.stringify({
        team_name: 'Test Team',
        description: 'A test team',
        manager_id: setup.userId
      })
    });
    
    console.log('Create team response:', createResponse.status);
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.log('Create team error:', error);
    }
    
    expect(createResponse.status).toBe(201);
    const createResult = await createResponse.json();
    expect(createResult.success).toBe(true);
    expect(createResult.data.team_name).toBe('Test Team');
    
    // Test listing teams
    const listResponse = await fetch(`${API_BASE_URL}/teams`, {
      method: 'GET',
      headers: {
        'x-api-key': setup.apiKey,
        'x-tenant-id': setup.tenantId
      }
    });
    
    console.log('List teams response:', listResponse.status);
    expect(listResponse.status).toBe(200);
    const listResult = await listResponse.json();
    expect(listResult.success).toBe(true);
    expect(listResult.data).toHaveLength(1);
    expect(listResult.data[0].team_name).toBe('Test Team');
  });
});