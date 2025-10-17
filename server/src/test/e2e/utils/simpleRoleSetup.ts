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
  const resources = ['contact', 'client', 'user', 'ticket', 'project', 'team', 'role', 'permission', 'time_entry', 'service'];
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
          tenant: tenantId
        });
        
        // Assign to role
        await db('role_permissions').insert({
          role_id: roleId,
          permission_id: permissionId,
          tenant: tenantId
        });
        
        console.log(`✅ Created permission ${resource}:${action} for tenant ${tenantId}`);
      } catch (error) {
        console.error(`❌ Error creating permission ${resource}:${action}:`, error);
        
        // If permission already exists for this tenant, try to find it and link to role
        try {
          const existingPermission = await db('permissions')
            .where({ resource, action, tenant: tenantId })
            .first();
            
          if (existingPermission) {
            await db('role_permissions').insert({
              role_id: roleId,
              permission_id: existingPermission.permission_id,
              tenant: tenantId
            });
            console.log(`✅ Linked existing permission ${resource}:${action} to role`);
          }
        } catch (linkError) {
          console.error(`❌ Error linking permission:`, linkError);
        }
      }
    }
  }
}
