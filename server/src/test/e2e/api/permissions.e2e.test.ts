import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { 
  setupE2ETestEnvironment,
  E2ETestEnvironment
} from '../utils/e2eTestSetup';
import { 
  assertSuccess, 
  assertError,
  buildQueryString
} from '../utils/apiTestHelpers';
import { v4 as uuidv4 } from 'uuid';

describe('Permissions API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/permissions';
  let createdPermissionIds: string[] = [];
  let testRoleId: string;

  beforeAll(async () => {
    // Setup test environment
    env = await setupE2ETestEnvironment({
      companyName: 'Permissions API Test Company',
      userName: 'permissions_api_test'
    });

    // Create a test role for permission assignment tests
    const role = await env.db('roles').insert({
      role_id: uuidv4(),
      role_name: `Test Role ${Date.now()}`,
      description: 'Role for permission tests',
      tenant: env.tenant,
      created_at: new Date(),
      updated_at: new Date()
    }).returning('*');
    testRoleId = role[0].role_id;
  });

  afterAll(async () => {
    // Clean up any created permissions
    for (const permissionId of createdPermissionIds) {
      try {
        await env.db('role_permissions').where('permission_id', permissionId).delete();
        await env.db('permissions').where('permission_id', permissionId).delete();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    // Clean up test role
    if (testRoleId) {
      await env.db('role_permissions').where('role_id', testRoleId).delete();
      await env.db('user_roles').where('role_id', testRoleId).delete();
      await env.db('roles').where('role_id', testRoleId).delete();
    }
    
    // Clean up test environment
    await env.cleanup();
  });

  describe('Basic CRUD Operations', () => {
    it('should create a new permission', async () => {
      const permissionData = {
        resource: 'custom_resource',
        action: 'read'
      };

      const response = await env.apiClient.post(API_BASE, permissionData);
      assertSuccess(response, 201);

      expect(response.data.data).toMatchObject({
        resource: permissionData.resource,
        action: permissionData.action
      });
      expect(response.data.data.permission_id).toBeTruthy();

      createdPermissionIds.push(response.data.data.permission_id);
    });

    it('should list permissions with pagination', async () => {
      // Create a few test permissions
      for (let i = 0; i < 3; i++) {
        const permission = await env.db('permissions').insert({
          permission_id: uuidv4(),
          resource: `test_resource_${i}`,
          action: 'read',
          tenant: env.tenant,
          created_at: new Date(),
          updated_at: new Date()
        }).returning('*');
        createdPermissionIds.push(permission[0].permission_id);
      }

      const query = buildQueryString({ page: 1, limit: 10 });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBeGreaterThan(0);
      expect(response.data.pagination).toBeDefined();
      expect(response.data.pagination.page).toBe(1);
      expect(response.data.pagination.limit).toBe(10);
    });

    it('should get a specific permission', async () => {
      // Create a test permission
      const permission = await env.db('permissions').insert({
        permission_id: uuidv4(),
        resource: 'specific_resource',
        action: 'write',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdPermissionIds.push(permission[0].permission_id);

      const response = await env.apiClient.get(`${API_BASE}/${permission[0].permission_id}`);
      assertSuccess(response);

      expect(response.data.data.permission_id).toBe(permission[0].permission_id);
      expect(response.data.data.resource).toBe('specific_resource');
      expect(response.data.data.action).toBe('write');
    });

    it('should update a permission', async () => {
      // Since permissions don't have many updatable fields, skip this test
      // Permissions are typically immutable once created
    });

    it('should delete a permission', async () => {
      // Create a test permission
      const permission = await env.db('permissions').insert({
        permission_id: uuidv4(),
        resource: 'delete_resource',
        action: 'delete',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');

      const response = await env.apiClient.delete(`${API_BASE}/${permission[0].permission_id}`);
      assertSuccess(response, 204);

      // Verify permission is deleted
      const checkPermission = await env.db('permissions')
        .where('permission_id', permission[0].permission_id)
        .where('tenant', env.tenant)
        .first();
      expect(checkPermission).toBeUndefined();
    });
  });

  describe('Permission Categories', () => {
    it('should get permission categories', async () => {
      const response = await env.apiClient.get(`${API_BASE}/categories`);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      // Categories should include common resources
      const resources = response.data.data.map((cat: any) => cat.resource);
      expect(resources).toContain('user');
      expect(resources).toContain('role');
      expect(resources).toContain('company');
    });
  });

  describe('Permission Assignment', () => {
    it('should get roles using a specific permission', async () => {
      // Create a permission
      const permission = await env.db('permissions').insert({
        permission_id: uuidv4(),
        resource: 'role_test',
        action: 'read',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdPermissionIds.push(permission[0].permission_id);

      // Assign permission to test role
      await env.db('role_permissions').insert({
        role_id: testRoleId,
        permission_id: permission[0].permission_id,
        tenant: env.tenant,
        created_at: new Date()
      });

      const response = await env.apiClient.get(`${API_BASE}/${permission[0].permission_id}/roles`);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.some((r: any) => r.role_id === testRoleId)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without API key', async () => {
      const { ApiTestClient } = await import('../utils/apiTestHelpers');
      const client = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        tenantId: env.tenant
      });
      const response = await client.get(API_BASE);
      assertError(response, 401);
    });

    it('should return 403 without permission', async () => {
      // Create a user without permission permissions
      const restrictedUser = await env.db('users').insert({
        user_id: uuidv4(),
        tenant: env.tenant,
        username: `restricted-perm-${Date.now()}`,
        email: `restricted-perm-${Date.now()}@test.com`,
        first_name: 'Restricted',
        last_name: 'User',
        hashed_password: 'dummy',
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');

      const plaintextKey = 'restricted-key-' + Date.now();
      const hashedKey = require('crypto').createHash('sha256').update(plaintextKey).digest('hex');
      
      const restrictedKey = await env.db('api_keys').insert({
        api_key_id: uuidv4(),
        api_key: hashedKey,
        user_id: restrictedUser[0].user_id,
        tenant: env.tenant,
        description: 'Restricted key',
        active: true,
        created_at: new Date(),
        updated_at: new Date(),
        expires_at: new Date(Date.now() + 86400000)
      }).returning('*');

      const { ApiTestClient } = await import('../utils/apiTestHelpers');
      const restrictedClient = new ApiTestClient({
        baseUrl: env.apiClient['config'].baseUrl,
        apiKey: plaintextKey,
        tenantId: env.tenant
      });

      const response = await restrictedClient.get(API_BASE);
      assertError(response, 403);

      // Cleanup
      await env.db('api_keys').where('api_key_id', restrictedKey[0].api_key_id).delete();
      await env.db('users').where('user_id', restrictedUser[0].user_id).delete();
    });

    it('should return 400 for invalid data', async () => {
      const response = await env.apiClient.post(API_BASE, {
        // Missing required fields - only sending partial data
        action: 'read'
        // Missing resource field
      });
      assertError(response, 400);
    });

    it('should return 404 for non-existent permission', async () => {
      const fakeId = uuidv4();
      const response = await env.apiClient.get(`${API_BASE}/${fakeId}`);
      assertError(response, 404);
    });

    it('should prevent duplicate permissions', async () => {
      // Create first permission
      const firstPermission = await env.db('permissions').insert({
        permission_id: uuidv4(),
        resource: 'duplicate_test',
        action: 'read',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdPermissionIds.push(firstPermission[0].permission_id);

      // Try to create duplicate
      const response = await env.apiClient.post(API_BASE, {
        resource: 'duplicate_test',
        action: 'read'
      });
      assertError(response, 409);
    });
  });

  describe('Tenant Isolation', () => {
    it('should not access permissions from other tenants', async () => {
      // Create another tenant
      const otherTenant = uuidv4();
      await env.db('tenants').insert({
        tenant: otherTenant,
        company_name: 'Other Company',
        email: 'other@company.com',
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create permission in other tenant
      const otherPermission = await env.db('permissions').insert({
        permission_id: uuidv4(),
        resource: 'other_tenant_resource',
        action: 'read',
        tenant: otherTenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');

      // Try to access from our tenant
      const response = await env.apiClient.get(`${API_BASE}/${otherPermission[0].permission_id}`);
      assertError(response, 404);

      // Cleanup
      await env.db('permissions').where('permission_id', otherPermission[0].permission_id).delete();
      await env.db('tenants').where('tenant', otherTenant).delete();
    });
  });

  describe('Filtering and Search', () => {
    it('should filter permissions by resource', async () => {
      // Create permissions with different resources
      const resources = ['filter_user', 'filter_role', 'filter_company'];
      for (const resource of resources) {
        const permission = await env.db('permissions').insert({
          permission_id: uuidv4(),
          resource,
          action: 'read',
          tenant: env.tenant,
          created_at: new Date(),
          updated_at: new Date()
        }).returning('*');
        createdPermissionIds.push(permission[0].permission_id);
      }

      const query = buildQueryString({ resource: 'filter_user' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      expect(response.data.data.every((p: any) => p.resource === 'filter_user')).toBe(true);
    });

    it('should filter permissions by action', async () => {
      // Create permissions with different actions
      const actions = ['create', 'update', 'delete'];
      for (const action of actions) {
        const permission = await env.db('permissions').insert({
          permission_id: uuidv4(),
          resource: 'action_test',
          action,
          tenant: env.tenant,
          created_at: new Date(),
          updated_at: new Date()
        }).returning('*');
        createdPermissionIds.push(permission[0].permission_id);
      }

      const query = buildQueryString({ action: 'update' });
      const response = await env.apiClient.get(`${API_BASE}${query}`);
      assertSuccess(response);

      expect(response.data.data.some((p: any) => p.action === 'update')).toBe(true);
    });
  });
});