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
    await db.query(
      'INSERT INTO tenants (tenant, company_name, is_active, created_at) VALUES ($1, $2, $3, $4)',
      [tenantId, `Test Company ${faker.company.name()}`, true, new Date()]
    );

    // Create user
    await db.query(
      `INSERT INTO users (
        user_id, tenant, username, first_name, last_name, 
        email, hashed_password, is_inactive, created_at, user_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userId,
        tenantId,
        faker.internet.username(),
        faker.person.firstName(),
        faker.person.lastName(),
        faker.internet.email(),
        'hashed_password_test',
        false,
        new Date(),
        'internal'
      ]
    );

    // Create API key
    await db.query(
      `INSERT INTO api_keys (
        key_id, tenant, user_id, key, name, 
        is_active, created_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        apiKeyId,
        tenantId,
        userId,
        apiKey,
        'Test API Key',
        true,
        new Date(),
        userId
      ]
    );

    // Create basic admin role and assign to user
    const adminRoleId = faker.string.uuid();
    await db.query(
      `INSERT INTO roles (
        role_id, tenant, role_name, description, 
        is_system, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        adminRoleId,
        tenantId,
        'Admin',
        'Administrator role with full permissions',
        true,
        new Date(),
        new Date()
      ]
    );

    // Assign role to user
    await db.query(
      'INSERT INTO user_roles (tenant, user_id, role_id) VALUES ($1, $2, $3)',
      [tenantId, userId, adminRoleId]
    );

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
      await db.query(
        'INSERT INTO role_permissions (tenant, role_id, permission) VALUES ($1, $2, $3)',
        [tenantId, adminRoleId, permission]
      );
    }
  });

  return {
    tenantId,
    apiKey,
    userId
  };
}