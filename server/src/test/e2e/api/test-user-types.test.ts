/**
 * Test different user types to find valid values
 */

import { describe, it, expect } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';

const API_BASE_URL = 'http://127.0.0.1:3000/api/v1';

describe('User Types Test', () => {
  it('should test different user types', async () => {
    const setup = await withTestSetup();
    
    const userTypes = ['internal', 'client', 'admin', 'contractor', 'employee'];
    const results: Record<string, any> = {};
    
    for (const userType of userTypes) {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': setup.apiKey,
          'x-tenant-id': setup.tenantId
        },
        body: JSON.stringify({
          username: `test_${userType}_${Date.now()}`,
          email: `test_${userType}_${Date.now()}@example.com`,
          password: 'SecurePass123!',
          first_name: 'Test',
          last_name: userType,
          user_type: userType
        })
      });
      
      results[userType] = {
        status: response.status,
        ok: response.ok
      };
      
      if (!response.ok) {
        const error = await response.text();
        results[userType].error = error;
      }
    }
    
    console.log('User type test results:');
    console.log(JSON.stringify(results, null, 2));
    
    // At least 'internal' should work
    expect(results.internal.ok).toBe(true);
  });
});