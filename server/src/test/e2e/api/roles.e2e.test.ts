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

describe('Roles API E2E Tests', () => {
  let env: E2ETestEnvironment;
  const API_BASE = '/api/v1/roles';
  let createdRoleIds: string[] = [];
  let testPermissionIds: string[] = [];

  beforeAll(async () => {
    // Setup test environment
    env = await setupE2ETestEnvironment({
      companyName: 'Roles API Test Company',
      userName: 'roles_api_test'
    });

    // Get some permission IDs for testing
    const permissions = await env.db('permissions')
      .where('tenant', env.tenant)
      .select('permission_id')
      .limit(3);
    testPermissionIds = permissions.map(p => p.permission_id);
  });

  afterAll(async () => {
    // Clean up any created roles
    for (const roleId of createdRoleIds) {
      try {
        await env.db('role_permissions').where('role_id', roleId).delete();
        await env.db('roles').where('role_id', roleId).delete();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
    
    // Clean up test environment
    await env.cleanup();
  });

  describe('Basic CRUD Operations', () => {
    it('should create a new role', async () => {
      const roleData = {
        role_name: `Test Role ${Date.now()}`,
        description: 'Test role description'
      };

      const response = await env.apiClient.post(API_BASE, roleData);
      assertSuccess(response, 201);

      expect(response.data.data).toMatchObject({
        role_name: roleData.role_name,
        description: roleData.description
      });
      expect(response.data.data.role_id).toBeTruthy();

      createdRoleIds.push(response.data.data.role_id);
    });

    it('should list roles with pagination', async () => {
      // Create a few test roles
      for (let i = 0; i < 3; i++) {
        const role = await env.db('roles').insert({
          role_id: uuidv4(),
          role_name: `List Test Role ${i} ${Date.now()}`,
          description: 'Test description',
          tenant: env.tenant,
          created_at: new Date(),
          updated_at: new Date()
        }).returning('*');
        createdRoleIds.push(role[0].role_id);
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

    it('should get a specific role', async () => {
      // Create a test role
      const role = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: `Get Test Role ${Date.now()}`,
        description: 'Test description',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdRoleIds.push(role[0].role_id);

      const response = await env.apiClient.get(`${API_BASE}/${role[0].role_id}`);
      assertSuccess(response);

      expect(response.data.data.role_id).toBe(role[0].role_id);
      expect(response.data.data.role_name).toBe(role[0].role_name);
    });

    it('should update a role', async () => {
      // Create a test role
      const role = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: `Update Test Role ${Date.now()}`,
        description: 'Original description',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdRoleIds.push(role[0].role_id);

      const updateData = {
        description: 'Updated description'
      };

      const response = await env.apiClient.put(`${API_BASE}/${role[0].role_id}`, updateData);
      assertSuccess(response);

      expect(response.data.data.description).toBe(updateData.description);
      expect(response.data.data.role_name).toBe(role[0].role_name); // Name should not change
    });

    it('should delete a role', async () => {
      // Create a test role
      const role = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: `Delete Test Role ${Date.now()}`,
        description: 'To be deleted',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');

      const response = await env.apiClient.delete(`${API_BASE}/${role[0].role_id}`);
      assertSuccess(response, 204);

      // Verify role is deleted
      const checkRole = await env.db('roles')
        .where('role_id', role[0].role_id)
        .where('tenant', env.tenant)
        .first();
      expect(checkRole).toBeUndefined();
    });
  });

  describe('Permission Management', () => {
    let testRoleId: string;

    beforeEach(async () => {
      // Create a test role for permission tests
      const role = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: `Permission Test Role ${Date.now()}`,
        description: 'For permission tests',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      testRoleId = role[0].role_id;
      createdRoleIds.push(testRoleId);
    });

    it('should assign permissions to a role', async () => {
      const response = await env.apiClient.put(`${API_BASE}/${testRoleId}/permissions`, {
        permission_ids: testPermissionIds
      });
      assertSuccess(response);

      // Verify permissions were assigned
      const assignedPermissions = await env.db('role_permissions')
        .where('role_id', testRoleId)
        .where('tenant', env.tenant)
        .select('permission_id');
      
      expect(assignedPermissions.length).toBe(testPermissionIds.length);
    });

    it('should get role permissions', async () => {
      // First assign some permissions
      for (const permId of testPermissionIds) {
        await env.db('role_permissions').insert({
          role_id: testRoleId,
          permission_id: permId,
          tenant: env.tenant,
          created_at: new Date()
        });
      }

      const response = await env.apiClient.get(`${API_BASE}/${testRoleId}/permissions`);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBe(testPermissionIds.length);
    });
  });

  describe('Role Templates', () => {
    it('should get available role templates', async () => {
      const response = await env.apiClient.get(`${API_BASE}/templates`);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
    });
  });

  describe('Role Cloning', () => {
    it('should clone an existing role', async () => {
      // Create a source role with permissions
      const sourceRole = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: `Source Role ${Date.now()}`,
        description: 'Role to clone',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdRoleIds.push(sourceRole[0].role_id);

      // Add permissions to source role
      await env.db('role_permissions').insert({
        role_id: sourceRole[0].role_id,
        permission_id: testPermissionIds[0],
        tenant: env.tenant,
        created_at: new Date()
      });

      const cloneData = {
        new_role_name: `Cloned Role ${Date.now()}`,
        new_description: 'Cloned role description'
      };

      const response = await env.apiClient.post(`${API_BASE}/${sourceRole[0].role_id}/clone`, cloneData);
      assertSuccess(response, 201);

      expect(response.data.data.role_name).toBe(cloneData.new_role_name);
      expect(response.data.data.description).toBe(cloneData.new_description);
      expect(response.data.data.role_id).not.toBe(sourceRole[0].role_id);

      createdRoleIds.push(response.data.data.role_id);
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk create roles', async () => {
      const rolesData = {
        roles: [
          {
            role_name: `Bulk Role 1 ${Date.now()}`,
            description: 'First bulk role'
          },
          {
            role_name: `Bulk Role 2 ${Date.now()}`,
            description: 'Second bulk role'
          }
        ]
      };

      const response = await env.apiClient.post(`${API_BASE}/bulk`, rolesData);
      assertSuccess(response);

      expect(response.data.data).toBeInstanceOf(Array);
      expect(response.data.data.length).toBe(2);
      
      // Track created roles for cleanup
      response.data.data.forEach((result: any) => {
        if (result.success && result.data.role_id) {
          createdRoleIds.push(result.data.role_id);
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without API key', async () => {
      const client = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        tenantId: env.tenant
      });
      const response = await client.get(API_BASE);
      assertError(response, 401);
    });

    it('should return 403 without permission', async () => {
      // Create a user without role permissions
      const restrictedUser = await env.db('users').insert({
        user_id: uuidv4(),
        tenant: env.tenant,
        username: `restricted-${Date.now()}`,
        email: `restricted-${Date.now()}@test.com`,
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

      const restrictedClient = new env.apiClient.constructor({
        baseUrl: env.apiClient.config.baseUrl,
        apiKey: plaintextKey,
        tenantId: env.tenant
      });

      const response = await restrictedClient.post(API_BASE, {
        role_name: 'Should fail',
        description: 'No permission'
      });
      assertError(response, 403);

      // Cleanup
      await env.db('api_keys').where('api_key_id', restrictedKey[0].api_key_id).delete();
      await env.db('users').where('user_id', restrictedUser[0].user_id).delete();
    });

    it('should return 400 for invalid data', async () => {
      const response = await env.apiClient.post(API_BASE, {
        // Missing required role_name
        description: 'Invalid role'
      });
      assertError(response, 400);
    });

    it('should return 404 for non-existent role', async () => {
      const fakeId = uuidv4();
      const response = await env.apiClient.get(`${API_BASE}/${fakeId}`);
      assertError(response, 404);
    });

    it('should prevent duplicate role names', async () => {
      const roleName = `Unique Role ${Date.now()}`;
      
      // Create first role
      const firstRole = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: roleName,
        description: 'First role',
        tenant: env.tenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');
      createdRoleIds.push(firstRole[0].role_id);

      // Try to create duplicate
      const response = await env.apiClient.post(API_BASE, {
        role_name: roleName,
        description: 'Duplicate role'
      });
      assertError(response, 409);
    });
  });

  describe('Tenant Isolation', () => {
    it('should not access roles from other tenants', async () => {
      // Create another tenant
      const otherTenant = uuidv4();
      await env.db('tenants').insert({
        tenant: otherTenant,
        company_name: 'Other Company',
        email: 'other@company.com',
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create role in other tenant
      const otherRole = await env.db('roles').insert({
        role_id: uuidv4(),
        role_name: 'Other Tenant Role',
        description: 'Should not be accessible',
        tenant: otherTenant,
        created_at: new Date(),
        updated_at: new Date()
      }).returning('*');

      // Try to access from our tenant
      const response = await env.apiClient.get(`${API_BASE}/${otherRole[0].role_id}`);
      assertError(response, 404);

      // Cleanup
      await env.db('roles').where('role_id', otherRole[0].role_id).delete();
      await env.db('tenants').where('tenant', otherTenant).delete();
    });
  });
});