/**
 * Permissions API E2E Tests
 * 
 * Comprehensive tests for all permission endpoints including:
 * - CRUD operations
 * - Permission categories
 * - Permission validation
 * - Error handling
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withTestSetup } from '../fixtures/test-setup';
import { permissionFactory } from '../factories/permission.factory';
import { roleFactory } from '../factories/role.factory';
import { userFactory } from '../factories/user.factory';
import { apiKeyFactory } from '../factories/apiKey.factory';
import { getConnection } from '../../../lib/db/db';
import { runWithTenant } from '../../../lib/db';

const API_BASE_URL = 'http://localhost:3000/api/v1';

describe('Permissions API E2E Tests', () => {
  let apiKey: string;
  let tenantId: string;
  let userId: string;
  let adminRoleId: string;

  beforeAll(async () => {
    // Set up test data
    const setup = await withTestSetup();
    tenantId = setup.tenantId;
    apiKey = setup.apiKey;
    userId = setup.userId;

    // Create an admin role for permission management
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      const adminRole = await roleFactory(db, { 
        tenant: tenantId, 
        role_name: 'Admin',
        description: 'Administrator role with full permissions'
      });
      adminRoleId = adminRole.role_id;

      // Assign permission management permissions to the admin role
      const adminPermissions = [
        'permission:read',
        'permission:create',
        'permission:update',
        'permission:delete'
      ];
      
      for (const permission of adminPermissions) {
        await db.query(
          'INSERT INTO role_permissions (tenant, role_id, permission) VALUES ($1, $2, $3)',
          [tenantId, adminRoleId, permission]
        );
      }

      // Assign admin role to the test user
      await db.query(
        'INSERT INTO user_roles (tenant, user_id, role_id) VALUES ($1, $2, $3)',
        [tenantId, userId, adminRoleId]
      );
    });
  });

  afterAll(async () => {
    // Clean up test data
    await runWithTenant(tenantId, async () => {
      const db = await getConnection();
      
      // Delete role permissions
      await db.query('DELETE FROM role_permissions WHERE tenant = $1', [tenantId]);
      
      // Delete user roles
      await db.query('DELETE FROM user_roles WHERE tenant = $1', [tenantId]);
      
      // Delete permissions
      await db.query('DELETE FROM permissions WHERE tenant = $1', [tenantId]);
      
      // Delete roles
      await db.query('DELETE FROM roles WHERE tenant = $1', [tenantId]);
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should create a new permission', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permission_name: 'custom:read',
          description: 'Read access to custom resources',
          category: 'custom',
          is_system: false
        })
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        permission_name: 'custom:read',
        description: 'Read access to custom resources',
        category: 'custom',
        is_system: false
      });
    });

    it('should list permissions with pagination', async () => {
      // Create multiple permissions
      await runWithTenant(tenantId, async () => {
        const db = await getConnection();
        const categories = ['project', 'ticket', 'user', 'report'];
        const actions = ['read', 'create', 'update', 'delete'];
        
        for (const category of categories) {
          for (const action of actions) {
            await permissionFactory(db, { 
              tenant: tenantId, 
              permission_name: `${category}:${action}`,
              category: category
            });
          }
        }
      });

      const response = await fetch(`${API_BASE_URL}/permissions?page=1&limit=10`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(10);
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 10,
        total: expect.any(Number)
      });
    });

    it('should filter permissions by category', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions?category=project`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.every((p: any) => p.category === 'project')).toBe(true);
    });

    it('should get a specific permission', async () => {
      const db = await getConnection();
      const permission = await runWithTenant(tenantId, async () => {
        return await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'special:access',
          description: 'Special access permission'
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions/${permission.permission_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.permission_id).toBe(permission.permission_id);
      expect(result.data.permission_name).toBe('special:access');
    });

    it('should update a permission', async () => {
      const db = await getConnection();
      const permission = await runWithTenant(tenantId, async () => {
        return await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'update:test',
          description: 'Old description'
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions/${permission.permission_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          description: 'Updated description',
          category: 'updated'
        })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.description).toBe('Updated description');
      expect(result.data.category).toBe('updated');
    });

    it('should delete a permission', async () => {
      const db = await getConnection();
      const permission = await runWithTenant(tenantId, async () => {
        return await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'delete:test',
          is_system: false
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions/${permission.permission_id}`, {
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
      const getResponse = await fetch(`${API_BASE_URL}/permissions/${permission.permission_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });
      expect(getResponse.status).toBe(404);
    });
  });

  describe('Permission Categories', () => {
    it('should get permission categories', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions/categories`, {
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
      
      // Check category structure
      const category = result.data.find((c: any) => c.name === 'project');
      expect(category).toBeDefined();
      expect(category).toHaveProperty('name');
      expect(category).toHaveProperty('description');
      expect(category).toHaveProperty('permissions');
      expect(category.permissions).toBeInstanceOf(Array);
    });

    it('should include permission count in categories', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions/categories`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      const projectCategory = result.data.find((c: any) => c.name === 'project');
      expect(projectCategory.permissions.length).toBeGreaterThan(0);
    });
  });

  describe('Permission Validation', () => {
    it('should validate permission name format', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permission_name: 'invalid format', // Should be resource:action
          description: 'Invalid permission'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('format');
    });

    it('should prevent duplicate permission names', async () => {
      const db = await getConnection();
      await runWithTenant(tenantId, async () => {
        await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'unique:permission'
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permission_name: 'unique:permission',
          description: 'Duplicate permission'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should prevent deletion of system permissions', async () => {
      const db = await getConnection();
      const systemPermission = await runWithTenant(tenantId, async () => {
        return await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'system:critical',
          is_system: true
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions/${systemPermission.permission_id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('system permission');
    });

    it('should prevent updating system permission name', async () => {
      const db = await getConnection();
      const systemPermission = await runWithTenant(tenantId, async () => {
        return await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'system:readonly',
          is_system: true
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions/${systemPermission.permission_id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          permission_name: 'system:modified'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot modify');
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without API key', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions`, {
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
      // Create a limited API key without permission management
      const db = await getConnection();
      const limitedKey = await runWithTenant(tenantId, async () => {
        const user = await userFactory(db, { 
          tenant: tenantId, 
          email: 'limited@example.com' 
        });
        
        // Create a role without permission management
        const limitedRole = await roleFactory(db, {
          tenant: tenantId,
          role_name: 'Limited User'
        });
        
        // Assign only basic permissions
        await db.query(
          'INSERT INTO role_permissions (tenant, role_id, permission) VALUES ($1, $2, $3)',
          [tenantId, limitedRole.role_id, 'project:read']
        );
        
        // Assign role to user
        await db.query(
          'INSERT INTO user_roles (tenant, user_id, role_id) VALUES ($1, $2, $3)',
          [tenantId, user.user_id, limitedRole.role_id]
        );
        
        return await apiKeyFactory(db, { 
          tenant: tenantId, 
          user_id: user.user_id 
        });
      });

      const response = await fetch(`${API_BASE_URL}/permissions`, {
        method: 'GET',
        headers: {
          'x-api-key': limitedKey.key,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(403);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('Permission denied');
    });

    it('should return 400 for invalid data', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        },
        body: JSON.stringify({
          // Missing required permission_name
          description: 'Invalid permission'
        })
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toContain('validation');
    });

    it('should return 404 for non-existent permission', async () => {
      const response = await fetch(`${API_BASE_URL}/permissions/non-existent-id`, {
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
  });

  describe('Tenant Isolation', () => {
    it('should not access permissions from other tenants', async () => {
      // Create another tenant and permission
      const otherSetup = await withTestSetup();
      const otherTenantId = otherSetup.tenantId;
      
      const db = await getConnection();
      const otherPermission = await runWithTenant(otherTenantId, async () => {
        return await permissionFactory(db, { 
          tenant: otherTenantId,
          permission_name: 'other:tenant'
        });
      });

      // Try to access from original tenant
      const response = await fetch(`${API_BASE_URL}/permissions/${otherPermission.permission_id}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(404);
    });

    it('should not see other tenant permissions in list', async () => {
      // Create permission in another tenant
      const otherSetup = await withTestSetup();
      const otherTenantId = otherSetup.tenantId;
      
      const db = await getConnection();
      await runWithTenant(otherTenantId, async () => {
        await permissionFactory(db, { 
          tenant: otherTenantId,
          permission_name: 'other:secret'
        });
      });

      // List permissions from original tenant
      const response = await fetch(`${API_BASE_URL}/permissions`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data.every((p: any) => p.permission_name !== 'other:secret')).toBe(true);
    });
  });

  describe('Permission Usage', () => {
    it('should get roles using a specific permission', async () => {
      const db = await getConnection();
      
      // Create a permission and assign it to roles
      const permission = await runWithTenant(tenantId, async () => {
        const perm = await permissionFactory(db, { 
          tenant: tenantId, 
          permission_name: 'usage:test'
        });

        // Create roles and assign permission
        const role1 = await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Role with Permission 1'
        });
        const role2 = await roleFactory(db, { 
          tenant: tenantId, 
          role_name: 'Role with Permission 2'
        });

        await db.query(
          'INSERT INTO role_permissions (tenant, role_id, permission) VALUES ($1, $2, $3)',
          [tenantId, role1.role_id, perm.permission_name]
        );
        await db.query(
          'INSERT INTO role_permissions (tenant, role_id, permission) VALUES ($1, $2, $3)',
          [tenantId, role2.role_id, perm.permission_name]
        );

        return perm;
      });

      const response = await fetch(`${API_BASE_URL}/permissions/${permission.permission_id}/roles`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'x-tenant-id': tenantId
        }
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data.some((r: any) => r.role_name === 'Role with Permission 1')).toBe(true);
      expect(result.data.some((r: any) => r.role_name === 'Role with Permission 2')).toBe(true);
    });
  });
});