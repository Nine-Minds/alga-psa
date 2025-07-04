import { describe, it } from 'vitest';
import { createTestDbConnection } from '../utils/apiTestHelpers';

describe('Check existing roles', () => {
  it('should check what roles exist', async () => {
    const db = await createTestDbConnection();
    
    try {
      // Check global roles
      console.log('\n🌍 Global roles:');
      const globalRoles = await db('roles')
        .whereNull('tenant')
        .select('role_id', 'role_name', 'description');
      
      globalRoles.forEach(role => {
        console.log(`  - ${role.role_name} (${role.role_id})`);
      });
      
      // Check global permissions
      console.log('\n🔑 Global permissions (sample):');
      const globalPermissions = await db('permissions')
        .whereNull('tenant')
        .select('permission_id', 'resource', 'action')
        .limit(10);
      
      globalPermissions.forEach(perm => {
        console.log(`  - ${perm.resource}:${perm.action} (${perm.permission_id})`);
      });
      
      // Check if there's a default admin role
      const adminRole = await db('roles')
        .whereNull('tenant')
        .where('role_name', 'like', '%Admin%')
        .first();
      
      if (adminRole) {
        console.log(`\n✅ Found admin role: ${adminRole.role_name}`);
        
        // Check its permissions
        const rolePerms = await db('role_permissions')
          .where('role_id', adminRole.role_id)
          .join('permissions', function() {
            this.on('role_permissions.permission_id', '=', 'permissions.permission_id')
              .andOnNull('role_permissions.tenant');
          })
          .select('permissions.resource', 'permissions.action')
          .limit(10);
        
        console.log('\nAdmin role permissions (sample):');
        rolePerms.forEach(perm => {
          console.log(`  - ${perm.resource}:${perm.action}`);
        });
      }
      
    } finally {
      await db.destroy();
    }
  });
});