import { describe, it } from 'vitest';
import { setupE2ETestEnvironment } from '../utils/e2eTestSetup';

describe('Test permissions', () => {
  it('should check user permissions', async () => {
    let env;
    try {
      env = await setupE2ETestEnvironment();
      
      // Check user in database
      const user = await env.db('users')
        .where('user_id', env.userId)
        .first();
      
      console.log('\n👤 User:', {
        user_id: user.user_id,
        username: user.username,
        tenant: user.tenant
      });
      
      // Check user roles
      const userRoles = await env.db('user_roles')
        .where('user_id', env.userId)
        .join('roles', 'user_roles.role_id', 'roles.role_id');
      
      console.log('\n👮 User roles:');
      userRoles.forEach(role => {
        console.log(`  - ${role.role_name} (${role.role_id})`);
      });
      
      // Check role permissions
      for (const role of userRoles) {
        const permissions = await env.db('role_permissions')
          .where('role_id', role.role_id)
          .join('permissions', 'role_permissions.permission_id', 'permissions.permission_id');
        
        console.log(`\n🔑 Permissions for role "${role.role_name}":`);
        permissions.forEach(perm => {
          console.log(`  - ${perm.resource}:${perm.action}`);
        });
      }
      
      // Try the API request
      console.log('\n📡 Making request to /api/v1/contacts...');
      const response = await env.apiClient.get('/api/v1/contacts');
      console.log('📊 Response:', response.status, JSON.stringify(response.data, null, 2));
      
    } catch (error) {
      console.error('❌ Error:', error);
    } finally {
      if (env) {
        await env.cleanup();
      }
    }
  });
});