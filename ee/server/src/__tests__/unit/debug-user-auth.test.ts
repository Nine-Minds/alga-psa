/**
 * Debug user authentication test
 * This test helps us understand what's happening during the authentication process
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import { createTestTenant, cleanupTestTenant } from '../../lib/testing/tenant-test-factory';
import { authenticateUser } from '../../../../../server/src/lib/actions/auth';
import { verifyPassword } from '../../../../../server/src/utils/encryption/encryption';
import type { Knex } from 'knex';

describe('Debug User Authentication', () => {
  let db: Knex;

  beforeEach(async () => {
    db = createTestDbConnection();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('should debug tenant user authentication process', async () => {
    // Create test tenant with admin user
    const tenantData = await createTestTenant(db, {
      companyName: 'Debug Auth Company',
      adminUser: { 
        firstName: 'Debug', 
        lastName: 'User', 
        email: 'debug.user@test.com' 
      }
    });

    console.log('Created tenant data:', {
      tenantId: tenantData.tenant.tenantId,
      email: tenantData.adminUser.email,
      temporaryPassword: tenantData.adminUser.temporaryPassword
    });

    // Check if user exists in database
    const userRecord = await db('users')
      .where({ email: tenantData.adminUser.email.toLowerCase() })
      .first();

    console.log('User record from database:', {
      user_id: userRecord?.user_id,
      email: userRecord?.email,
      username: userRecord?.username,
      tenant: userRecord?.tenant,
      user_type: userRecord?.user_type,
      is_inactive: userRecord?.is_inactive,
      hashed_password_preview: userRecord?.hashed_password?.substring(0, 50) + '...',
      created_at: userRecord?.created_at
    });

    // Test direct password verification
    const isPasswordValid = await verifyPassword(
      tenantData.adminUser.temporaryPassword, 
      userRecord?.hashed_password
    );
    console.log('Direct password verification result:', isPasswordValid);

    // Test authenticateUser function
    const authResult = await authenticateUser(
      tenantData.adminUser.email, 
      tenantData.adminUser.temporaryPassword
    );
    console.log('authenticateUser result:', authResult ? {
      user_id: authResult.user_id,
      email: authResult.email,
      tenant: authResult.tenant,
      is_inactive: authResult.is_inactive
    } : null);

    // Check user roles
    const userRoles = await db('user_roles')
      .where({ user_id: userRecord?.user_id })
      .first();
    console.log('User roles:', userRoles);

    // Cleanup
    await cleanupTestTenant(db, tenantData.tenant.tenantId);

    // Assertions for actual test
    expect(userRecord).toBeTruthy();
    expect(userRecord?.email).toBe(tenantData.adminUser.email.toLowerCase());
    expect(userRecord?.is_inactive).toBe(false);
    expect(isPasswordValid).toBe(true);
    expect(authResult).toBeTruthy();
  });
});