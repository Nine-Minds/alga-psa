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

  // Set up test data in database
  await runWithTenant(tenantId, async () => {
    const db = await getConnection();
    
    // Create tenant
    await db('tenants').insert({
      tenant: tenantId,
      company_name: `Test Company ${faker.company.name()}`,
      is_active: true,
      created_at: new Date()
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
      key_id: apiKeyId,
      tenant: tenantId,
      user_id: userId,
      key: apiKey,
      name: 'Test API Key',
      is_active: true,
      created_at: new Date(),
      created_by: userId
    });

    // Create basic admin role and assign to user
    const adminRoleId = faker.string.uuid();
    await db('roles').insert({
      role_id: adminRoleId,
      tenant: tenantId,
      role_name: 'Admin',
      description: 'Administrator role with full permissions',
      is_system: true,
      created_at: new Date(),
      updated_at: new Date()
    });

    // Assign role to user
    await db('user_roles').insert({
      tenant: tenantId,
      user_id: userId,
      role_id: adminRoleId
    });

    // Create permissions for admin role
    const permissions = [
      'contact:read', 'contact:create', 'contact:update', 'contact:delete',
      'company:read', 'company:create', 'company:update', 'company:delete',
      'user:read', 'user:create', 'user:update', 'user:delete',
      'project:read', 'project:create', 'project:update', 'project:delete',
      'ticket:read', 'ticket:create', 'ticket:update', 'ticket:delete',
      'team:read', 'team:create', 'team:update', 'team:delete',
      'role:read', 'role:create', 'role:update', 'role:delete',
      'permission:read', 'permission:create', 'permission:update', 'permission:delete',
      'time_entry:read', 'time_entry:create', 'time_entry:update', 'time_entry:delete', 'time_entry:approve'
    ];

    for (const permission of permissions) {
      await db('role_permissions').insert({
        tenant: tenantId,
        role_id: adminRoleId,
        permission: permission
      });
    }
  });

  return {
    tenantId,
    apiKey,
    userId
  };
}