import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Simple role setup for testing - creates a basic user with permissions
 * without dealing with complex tenant-specific permission structures
 */
export async function setupTestUserWithPermissions(
  db: Knex, 
  userId: string, 
  tenantId: string
): Promise<void> {
  const tenantTable = (table: string) => tenantDb(db, tenantId).table(table);

  // Check if user already has roles
  const existingRole = await tenantTable('user_roles')
    .where({ user_id: userId })
    .first<{ role_id: string }>();

  let roleId = existingRole?.role_id ?? null;

  if (!roleId) {
    roleId = require('crypto').randomUUID();
    await tenantTable('roles').insert({
      role_id: roleId,
      role_name: 'Test Admin',
      description: 'Test role with all permissions',
      tenant: tenantId,
      created_at: new Date(),
      updated_at: new Date()
    });

    await tenantTable('user_roles').insert({
      user_id: userId,
      role_id: roleId,
      tenant: tenantId
    });
  }

  // Create basic permissions for the tenant
  const resources = [
    'contact',
    'client',
    'user',
    'ticket',
    'project',
    'team',
    'role',
    'permission',
    'time_entry',
    'service',
    'storage',
  ];
  const actions = ['create', 'read', 'update', 'delete'];
  
  for (const resource of resources) {
    for (const action of actions) {
      // Create tenant-specific permission
      const permissionId = require('crypto').randomUUID();
      
      const existingPermission = await tenantTable('permissions')
        .where({ resource, action })
        .first<{ permission_id: string }>();

      const targetPermissionId = existingPermission?.permission_id ?? permissionId;

      if (!existingPermission) {
        await tenantTable('permissions').insert({
          permission_id: targetPermissionId,
          resource,
          action,
          tenant: tenantId
        });
      }

      await tenantTable('role_permissions')
        .insert({
          role_id: roleId!,
          permission_id: targetPermissionId,
          tenant: tenantId
        })
        .catch((error: any) => {
          if (error?.code !== '23505') {
            throw error;
          }
        });
    }
  }
}
