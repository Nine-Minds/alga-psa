/**
 * Basic test to verify test setup is working
 */

import { describe, it, expect } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';
import { getConnection } from '../../../lib/db/db';
import { runWithTenant } from '../../../lib/db';

describe('Basic Test Setup', () => {
  it('should create test data successfully', async () => {
    const setup = await withTestSetup();
    
    expect(setup.tenantId).toBeDefined();
    expect(setup.apiKey).toBeDefined();
    expect(setup.userId).toBeDefined();
    
    // Verify data was created
    await runWithTenant(setup.tenantId, async () => {
      const db = await getConnection();
      
      // Check tenant
      const tenant = await db('tenants')
        .where('tenant', setup.tenantId)
        .first();
      expect(tenant).toBeDefined();
      
      // Check user
      const user = await db('users')
        .where('user_id', setup.userId)
        .first();
      expect(user).toBeDefined();
      
      // Check API key - using user_id since we can't match on hashed key
      const apiKey = await db('api_keys')
        .where('user_id', setup.userId)
        .where('tenant', setup.tenantId)
        .first();
      expect(apiKey).toBeDefined();
      
      // Clean up
      await db('api_keys').where('tenant', setup.tenantId).delete();
      await db('user_roles').where('tenant', setup.tenantId).delete();
      await db('role_permissions').where('tenant', setup.tenantId).delete();
      await db('roles').where('tenant', setup.tenantId).delete();
      await db('users').where('tenant', setup.tenantId).delete();
      await db('tenants').where('tenant', setup.tenantId).delete();
    });
  });
});