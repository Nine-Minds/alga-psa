/**
 * Roles API E2E Tests
 * 
 * Comprehensive tests for all role endpoints including:
 * - CRUD operations
 * - Permission assignment
 * - Role templates
 * - Role cloning
 * - User role assignment
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';
import { roleFactory } from '../factories/role.factory';
import { userFactory } from '../factories/user.factory';
import { apiKeyFactory } from '../factories/apiKey.factory';
import { getConnection } from '../../../lib/db/db';
import { runWithTenant } from '../../../lib/db';

const API_BASE_URL = 'http://localhost:3001/api/v1';

describe('Roles API E2E Tests', () => {
  let apiKey: string;
  let tenantId: string;
  let userId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Set up test data
    const setup = await withTestSetup();
    tenantId = setup.tenantId;
    apiKey = setup.apiKey;
    userId = setup.userId;

    // Create additional user for role assignment tests
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      const testUser = await userFactory(db, { 
        tenant: tenantId, 
        email: 'roletest@example.com',
        firstName: 'Role',
        lastName: 'Test'
      });
      testUserId = testUser.user_id;
    });
  });

  afterAll(async () => {
    // Clean up test data
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      
      // Delete role permissions first
      await db.raw('DELETE FROM role_permissions WHERE tenant = ?', [tenantId]);
      
      // Delete user roles
      await db.raw('DELETE FROM user_roles WHERE tenant = ?', [tenantId]);
      
      // Delete roles
      await db.raw('DELETE FROM roles WHERE tenant = ?', [tenantId]);
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should create a new role', async () => {
      const response = await fetch(`${API_BASE_URL}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          role_name: 'Project Manager',
          description: 'Manages projects and teams',
          is_system: false
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        role_name: 'Project Manager',
        description: 'Manages projects and teams',
        is_system: false
      });
    });

    it('should list roles with pagination', async () => {
      // Create multiple roles
      await runWithTenant(tenantId, async () => {
        const db = await getConnection();
        for (let i = 0; i < 5; i++) {
          await roleFactory(db, { 
            tenant: tenantId, 
            role_name: `Role ${i + 1}`
          });
        }
      });

      const response = await fetch(`${API_BASE_URL}/roles?page=1&limit=3`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(3);
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 3,
        total: expect.any(Number)
      });
    });

    it('should get a specific role', async () => {
      const db = await getConnection();
      const role = await runWithTenant(tenantId, async () => {
        return await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Developer',
          description: 'Software development role'
        });
      });

      const response = await fetch(`${API_BASE_URL}/roles/${role.role_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.role_id).toBe(role.role_id);
      expect(result.data.role_name).toBe('Developer');
    });

    it('should update a role', async () => {
      const db = await getConnection();
      const role = await runWithTenant(tenantId, async () => {
        return await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Old Role Name'
        });
      });

      const response = await fetch(`${API_BASE_URL}/roles/${role.role_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          role_name: 'Updated Role Name',
          description: 'Updated description'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.role_name).toBe('Updated Role Name');
      expect(result.data.description).toBe('Updated description');
    });

    it('should delete a role', async () => {
      const db = await getConnection();
      const role = await runWithTenant(tenantId, async () => {
        return await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Role to Delete'
        });
      });

      const response = await fetch(`${API_BASE_URL}/roles/${role.role_id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Verify deletion
      const getResponse = await fetch(`${API_BASE_URL}/roles/${role.role_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      expect(getResponse.status).toBe(404);
    });
  });

  describe('Permission Management', () => {
    let roleId: string;

    beforeAll(async () => {
      // Create a role for permission tests
      const db = await getConnection();
      const role = await runWithTenant(tenantId, async () => {
        return await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Permission Test Role'
        });
      });
      roleId = role.role_id;
    });

    it('should assign permissions to a role', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/${roleId}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permissions: [
            'project:read',
            'project:create',
            'project:update',
            'ticket:read',
            'ticket:create'
          ]
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.assigned_count).toBe(5);
    });

    it('should get role permissions', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/${roleId}/permissions`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(5);
      expect(result.data).toContain('project:read');
      expect(result.data).toContain('ticket:create');
    });

    it('should remove permissions from a role', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/${roleId}/permissions`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permissions: ['project:create', 'ticket:create']
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.removed_count).toBe(2);

      // Verify permissions were removed
      const getResponse = await fetch(`${API_BASE_URL}/roles/${roleId}/permissions`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      const getResult = await getResponse.json();
      expect(getResult.data).toHaveLength(3);
      expect(getResult.data).not.toContain('project:create');
      expect(getResult.data).not.toContain('ticket:create');
    });
  });

  describe('Role Templates', () => {
    it('should get available role templates', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/templates`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBeInstanceOf(Array);
      expect(result.data.length).toBeGreaterThan(0);
      
      // Check template structure
      const template = result.data[0];
      expect(template).toHaveProperty('name');
      expect(template).toHaveProperty('description');
      expect(template).toHaveProperty('permissions');
      expect(template.permissions).toBeInstanceOf(Array);
    });

    it('should create role from template', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/from-template`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          template_name: 'project_manager',
          role_name: 'Senior Project Manager'
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.role_name).toBe('Senior Project Manager');
      expect(result.data).toHaveProperty('role_id');
    });
  });

  describe('Role Cloning', () => {
    it('should clone an existing role', async () => {
      // Create a role with permissions
      const db = await getConnection();
      const originalRole = await runWithTenant(tenantId, async () => {
        const role = await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Original Role',
          description: 'Role to be cloned'
        });

        // Add permissions
        const permissions = ['project:read', 'project:update', 'ticket:read'];
        for (const permission of permissions) {
          await db.raw(
            'INSERT INTO role_permissions (tenant, role_id, permission) VALUES (?, ?, ?)',
            [tenantId, role.role_id, permission]
          );
        }

        return role;
      });

      const response = await fetch(`${API_BASE_URL}/roles/${originalRole.role_id}/clone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          new_role_name: 'Cloned Role',
          description: 'This is a cloned role'
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.role_name).toBe('Cloned Role');
      expect(result.data.description).toBe('This is a cloned role');

      // Verify permissions were cloned
      const permResponse = await fetch(`${API_BASE_URL}/roles/${result.data.role_id}/permissions`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      const permResult = await permResponse.json();
      expect(permResult.data).toHaveLength(3);
      expect(permResult.data).toContain('project:read');
    });
  });

  describe('User Role Assignment', () => {
    let roleId: string;

    beforeAll(async () => {
      // Create a role for assignment tests
      const db = await getConnection();
      const role = await runWithTenant(tenantId, async () => {
        return await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Assignment Test Role'
        });
      });
      roleId = role.role_id;
    });

    it('should assign role to user', async () => {
      const response = await fetch(`${API_BASE_URL}/users/${testUserId}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          role_ids: [roleId]
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.assigned_count).toBe(1);
    });

    it('should get users with specific role', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/${roleId}/users`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_id).toBe(testUserId);
    });

    it('should remove role from user', async () => {
      const response = await fetch(`${API_BASE_URL}/users/${testUserId}/roles/${roleId}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      // Verify role was removed
      const getUsersResponse = await fetch(`${API_BASE_URL}/roles/${roleId}/users`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      const getUsersResult = await getUsersResponse.json();
      expect(getUsersResult.data).toHaveLength(0);
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk create roles', async () => {
      const roles = [
        {
          role_name: 'Bulk Role 1',
          description: 'First bulk role',
          permissions: ['project:read', 'ticket:read']
        },
        {
          role_name: 'Bulk Role 2',
          description: 'Second bulk role',
          permissions: ['user:read', 'user:update']
        }
      ];

      const response = await fetch(`${API_BASE_URL}/roles/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({ roles })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.created_count).toBe(2);
      expect(result.data.roles).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without API key', async () => {
      const response = await fetch(`${API_BASE_URL}/roles`, {
        method: 'GET',
        headers: {
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(401);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key required');
    });

    it('should return 403 without permission', async () => {
      // Create a limited API key without role permissions
      const db = await getConnection();
      const limitedKey = await runWithTenant(tenantId, async () => {
        const user = await userFactory(db, { 
          tenant: tenantId, 
          email: 'limited@example.com' 
        });
        return await apiKeyFactory(db, { 
          tenant: tenantId, 
          user_id: user.user_id 
        });
      });

      const response = await fetch(`${API_BASE_URL}/roles`, {
        method: 'GET',
        headers: {
          'x-api-key': limitedKey.key,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(403);
    });

    it('should return 400 for invalid data', async () => {
      const response = await fetch(`${API_BASE_URL}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          // Missing required role_name
          description: 'Invalid role'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation');
    });

    it('should return 404 for non-existent role', async () => {
      const response = await fetch(`${API_BASE_URL}/roles/non-existent-id`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result.success).toBe(false);
    });

    it('should prevent duplicate role names', async () => {
      const db = await getConnection();
      await runWithTenant(tenantId, async () => {
        await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Unique Role Name'
        });
      });

      const response = await fetch(`${API_BASE_URL}/roles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          role_name: 'Unique Role Name',
          description: 'Attempting to create duplicate'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should prevent deletion of system roles', async () => {
      const db = await getConnection();
      const systemRole = await runWithTenant(tenantId, async () => {
        return await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'System Admin',
          is_system: true
        });
      });

      const response = await fetch(`${API_BASE_URL}/roles/${systemRole.role_id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('system role');
    });
  });

  describe('Tenant Isolation', () => {
    it('should not access roles from other tenants', async () => {
      // Create another tenant and role
      const otherSetup = await withTestSetup();
      const otherTenantId = otherSetup.tenantId;
      
      const db = await getConnection();
      const otherRole = await runWithTenant(otherTenantId, async () => {
        return await roleFactory(db, { 
          tenant: otherTenantId,
          role_name: 'Other Tenant Role'
        });
      });

      // Try to access from original tenant
      const response = await fetch(`${API_BASE_URL}/roles/${otherRole.role_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
    });
  });
});