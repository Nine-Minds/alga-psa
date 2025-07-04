import { Knex } from 'knex';

/**
 * Simple role setup for testing - creates a basic user with permissions
 * without dealing with complex tenant-specific permission structures
 */
export async function setupTestUserWithPermissions(
  db: Knex, 
  userId: string, 
  tenantId: string
): Promise<void> {
  // Check if user already has roles
  const existingRoles = await db('user_roles')
    .where('user_id', userId)
    .count('* as count');
  
  if (existingRoles[0].count > 0) {
    console.log('User already has roles, skipping setup');
    return;
  }

  // Create a simple test role
  const roleId = require('crypto').randomUUID();
  await db('roles').insert({
    role_id: roleId,
    role_name: 'Test Admin',
    description: 'Test role with all permissions',
    tenant: tenantId,
    created_at: new Date(),
    updated_at: new Date()
  });

  // Assign role to user
  await db('user_roles').insert({
    user_id: userId,
    role_id: roleId,
    tenant: tenantId
  });

  // Create basic permissions for the tenant
  const resources = ['contact', 'company', 'user', 'ticket'];
  const actions = ['create', 'read', 'update', 'delete'];
  
  for (const resource of resources) {
    for (const action of actions) {
      // Create tenant-specific permission
      const permissionId = require('crypto').randomUUID();
      
      try {
        await db('permissions').insert({
          permission_id: permissionId,
          resource,
          action,
          description: `${action} ${resource}`,
          tenant: tenantId
        });
        
        // Assign to role
        await db('role_permissions').insert({
          role_id: roleId,
          permission_id: permissionId,
          tenant: tenantId
        });
      } catch (error) {
        // Permission might already exist, that's OK
        console.log(`Permission ${resource}:${action} might already exist`);
      }
    }
  }
}