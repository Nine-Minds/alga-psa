import { describe, it } from 'vitest';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';
import { getConnection } from '../../../lib/db/db';
import User from '../../../lib/models/user';

describe('Debug Permissions', () => {
  it('should debug permission loading', async () => {
    let env;
    try {
      env = await setupE2ETestEnvironment();
      
      console.log('\n🔍 Debug Info:');
      console.log('Tenant:', env.tenant);
      console.log('User ID:', env.userId);
      
      // Get connection for this tenant
      const knex = await getConnection(env.tenant);
      
      // Check user roles directly
      console.log('\n📋 User Roles:');
      const userRoles = await knex('user_roles')
        .where('user_id', env.userId)
        .where('tenant', env.tenant);
      console.log('User roles found:', userRoles.length);
      userRoles.forEach(ur => console.log(`  - Role ID: ${ur.role_id}`));
      
      // Check roles
      console.log('\n👮 Roles:');
      const roles = await knex('roles')
        .where('tenant', env.tenant);
      console.log('Roles found:', roles.length);
      roles.forEach(r => console.log(`  - ${r.role_name} (${r.role_id})`));
      
      // Check permissions
      console.log('\n🔑 Permissions:');
      const permissions = await knex('permissions')
        .where('tenant', env.tenant);
      console.log('Permissions found:', permissions.length);
      permissions.slice(0, 5).forEach(p => console.log(`  - ${p.resource}:${p.action} (${p.permission_id})`));
      
      // Check role permissions
      console.log('\n🔗 Role Permissions:');
      const rolePermissions = await knex('role_permissions')
        .where('tenant', env.tenant);
      console.log('Role permissions found:', rolePermissions.length);
      
      // Test getUserRolesWithPermissions
      console.log('\n🧪 Testing getUserRolesWithPermissions:');
      try {
        const rolesWithPerms = await User.getUserRolesWithPermissions(knex, env.userId);
        console.log('Roles with permissions:', rolesWithPerms.length);
        rolesWithPerms.forEach(rwp => {
          console.log(`  - ${rwp.role_name}: ${rwp.permissions.length} permissions`);
          rwp.permissions.slice(0, 3).forEach(p => {
            console.log(`    - ${p.resource}:${p.action}`);
          });
        });
      } catch (error) {
        console.error('Error getting roles with permissions:', error);
      }
      
      // Make API request
      console.log('\n📡 Making API request...');
      const response = await env.apiClient.get('/api/v1/contacts');
      console.log('Response status:', response.status);
      if (response.status !== 200) {
        console.log('Response:', JSON.stringify(response.data, null, 2));
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
    } finally {
      if (env) {
        await env.cleanup();
      }
    }
  });
});