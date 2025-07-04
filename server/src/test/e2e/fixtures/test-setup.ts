/**
 * Simple test setup for E2E tests
 * Returns basic test data needed for API testing
 */

import { faker } from '@faker-js/faker';
import { getConnection } from '../../../lib/db/db';
import { runWithTenant } from '../../../lib/db';

interface TestSetup {
  tenantId: string;
  apiKey: string;
  userId: string;
}

export async function withTestSetup(): Promise<TestSetup> {
  // Generate test IDs
  const tenantId = faker.string.uuid();
  const userId = faker.string.uuid();
  const apiKeyId = faker.string.uuid();
  const apiKey = faker.string.alphanumeric(32);
  
  // Import crypto for hashing
  const crypto = await import('crypto');
  const hashedApiKey = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Set up test data in database
  await runWithTenant(tenantId, async () => {
    const db = await getConnection();
    
    // Create tenant
    await db('tenants').insert({
      tenant: tenantId,
      company_name: `Test Company ${faker.company.name()}`,
      phone_number: faker.phone.number(),
      email: faker.internet.email(),
      created_at: new Date(),
      updated_at: new Date(),
      payment_platform_id: `test-platform-${tenantId.substring(0, 8)}`,
      payment_method_id: `test-method-${tenantId.substring(0, 8)}`,
      auth_service_id: `test-auth-${tenantId.substring(0, 8)}`,
      plan: 'test'
    });

    // Create user
    await db('users').insert({
      user_id: userId,
      tenant: tenantId,
      username: faker.internet.username(),
      first_name: faker.person.firstName(),
      last_name: faker.person.lastName(),
      email: faker.internet.email(),
      hashed_password: 'hashed_password_test',
      is_inactive: false,
      created_at: new Date(),
      user_type: 'internal'
    });

    // Create API key
    await db('api_keys').insert({
      api_key_id: apiKeyId,
      tenant: tenantId,
      user_id: userId,
      api_key: hashedApiKey,
      description: 'Test API Key',
      active: true,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Create basic admin role and assign to user
    const adminRoleId = faker.string.uuid();
    await db('roles').insert({
      role_id: adminRoleId,
      tenant: tenantId,
      role_name: 'Admin',
      description: 'Administrator role with full permissions',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Assign role to user
    await db('user_roles').insert({
      tenant: tenantId,
      user_id: userId,
      role_id: adminRoleId
    });

    // Create permissions for the admin role
    // The permission system expects resource/action pairs stored in the role_permissions table
    const permissions = [
      { resource: 'contact', action: 'read' },
      { resource: 'contact', action: 'create' },
      { resource: 'contact', action: 'update' },
      { resource: 'contact', action: 'delete' },
      { resource: 'company', action: 'read' },
      { resource: 'company', action: 'create' },
      { resource: 'company', action: 'update' },
      { resource: 'company', action: 'delete' },
      { resource: 'user', action: 'read' },
      { resource: 'user', action: 'create' },
      { resource: 'user', action: 'update' },
      { resource: 'user', action: 'delete' },
      { resource: 'project', action: 'read' },
      { resource: 'project', action: 'create' },
      { resource: 'project', action: 'update' },
      { resource: 'project', action: 'delete' },
      { resource: 'ticket', action: 'read' },
      { resource: 'ticket', action: 'create' },
      { resource: 'ticket', action: 'update' },
      { resource: 'ticket', action: 'delete' },
      { resource: 'team', action: 'read' },
      { resource: 'team', action: 'create' },
      { resource: 'team', action: 'update' },
      { resource: 'team', action: 'delete' },
      { resource: 'role', action: 'read' },
      { resource: 'role', action: 'create' },
      { resource: 'role', action: 'update' },
      { resource: 'role', action: 'delete' },
      { resource: 'permission', action: 'read' },
      { resource: 'permission', action: 'create' },
      { resource: 'permission', action: 'update' },
      { resource: 'permission', action: 'delete' },
      { resource: 'time_entry', action: 'read' },
      { resource: 'time_entry', action: 'create' },
      { resource: 'time_entry', action: 'update' },
      { resource: 'time_entry', action: 'delete' },
      { resource: 'time_entry', action: 'approve' }
    ];

    // First create permissions in the permissions table
    for (const perm of permissions) {
      const permissionId = faker.string.uuid();
      await db('permissions').insert({
        permission_id: permissionId,
        tenant: tenantId,
        resource: perm.resource,
        action: perm.action,
        created_at: new Date()
      });
      
      // Then assign to role
      await db('role_permissions').insert({
        tenant: tenantId,
        role_id: adminRoleId,
        permission_id: permissionId
      });
    }
  });

  return {
    tenantId,
    apiKey,
    userId
  };
}