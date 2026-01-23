import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, type TestDatabase } from '../../test-utils/database';
import { withAdminTransaction } from '@alga-psa/db.js';
import { v4 as uuidv4 } from 'uuid';
import { hashPassword, generateSecurePassword } from '@alga-psa/shared/utils/encryption.js';
import type { Knex } from 'knex';

// Simple database operations that mirror the user activity logic without Temporal context
async function createAdminUserInDB(
  input: {
    tenantId: string;
    firstName: string;
    lastName: string;
    email: string;
    clientId?: string;
  },
  testDb?: TestDatabase
) {
  return await withAdminTransaction(async (trx: Knex.Transaction) => {
    // Check if user already exists globally
    const existingUser = await trx('users')
      .where({ email: input.email.toLowerCase() })
      .first();

    if (existingUser) {
      throw new Error(`User with email ${input.email} already exists`);
    }

    // Generate user ID and temporary password
    const userId = uuidv4();
    const temporaryPassword = generateSecurePassword();

    // Hash the temporary password
    const hashedPassword = await hashPassword(temporaryPassword);

    // Create user record
    await trx('users').insert({
      user_id: userId,
      tenant: input.tenantId,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email.toLowerCase(),
      username: input.email.toLowerCase(),
      hashed_password: hashedPassword,
      user_type: 'internal',
      is_inactive: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Get or create Admin role
    let adminRole = await trx('roles')
      .where({ 
        tenant: input.tenantId,
      })
      .whereRaw('LOWER(role_name) = ?', ['admin'])
      .first();

    if (!adminRole) {
      // Create Admin role if it doesn't exist
      const roleId = uuidv4();
      await trx('roles').insert({
        role_id: roleId,
        tenant: input.tenantId,
        role_name: 'Admin',
        description: 'Administrator with full system access',
        created_at: new Date(),
      });

      adminRole = { role_id: roleId };
    }

    // Assign Admin role to user
    await trx('user_roles').insert({
      user_id: userId,
      role_id: adminRole.role_id,
      tenant: input.tenantId,
      created_at: new Date(),
    });

    // If a client was created, associate the user as the account manager
    if (input.clientId) {
      await trx('clients')
        .where({ 
          client_id: input.clientId,
          tenant: input.tenantId 
        })
        .update({ 
          account_manager_id: userId,
          updated_at: new Date(),
        });
    }

    // Track user for cleanup
    if (testDb) {
      testDb.trackUser(userId);
    }

    return {
      userId,
      roleId: adminRole.role_id,
      temporaryPassword,
    };
  });
}

async function rollbackUserInDB(userId: string, tenantId: string): Promise<void> {
  return await withAdminTransaction(async (trx: Knex.Transaction) => {
    // Remove user preferences
    await trx('user_preferences')
      .where({ user_id: userId })
      .del();

    // Remove user roles
    await trx('user_roles')
      .where({ 
        user_id: userId,
        tenant: tenantId 
      })
      .del();

    // Remove user as account manager from clients
    await trx('clients')
      .where({ 
        account_manager_id: userId,
        tenant: tenantId 
      })
      .update({ 
        account_manager_id: null,
        updated_at: new Date(),
      });

    // Remove the user
    await trx('users')
      .where({ 
        user_id: userId,
        tenant: tenantId 
      })
      .del();
  });
}

describe('User Activities Database Logic', () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await setupTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  describe('createAdminUserInDB', () => {
    it('should create an admin user with all required fields', async () => {
      // First create a tenant to use
      const tenantId = uuidv4();
      const timestamp = Date.now();
      await testDb.createTenant({
        tenantId,
        tenantName: 'Test Tenant',
        email: 'tenant@test.com'
      });

      const input = {
        tenantId,
        firstName: 'John',
        lastName: 'Admin',
        email: `john.admin-${timestamp}@testclient.com`
      };

      const result = await createAdminUserInDB(input, testDb);

      expect(result.userId).toBeDefined();
      expect(result.roleId).toBeDefined();
      expect(result.temporaryPassword).toBeDefined();
      expect(result.temporaryPassword).toHaveLength(12);

      // Verify user was created in database
      const user = await testDb.getUserById(result.userId, tenantId);
      expect(user).toBeDefined();
      expect(user.first_name).toBe('John');
      expect(user.last_name).toBe('Admin');
      expect(user.email).toBe(`john.admin-${timestamp}@testclient.com`);
      expect(user.user_type).toBe('internal');
      expect(user.is_inactive).toBe(false);

      // Verify user role assignment
      const userRoles = await testDb.getUserRoles(result.userId, tenantId);
      expect(userRoles).toHaveLength(1);
      expect(userRoles[0].role_id).toBe(result.roleId);

      // Verify Admin role was created
      const role = await testDb.getRoleById(result.roleId, tenantId);
      expect(role).toBeDefined();
      expect(role.role_name).toBe('Admin');
    });

    it('should create user and associate with client as account manager', async () => {
      // First create a tenant and client
      const tenantId = uuidv4();
      const clientId = uuidv4();
      const timestamp = Date.now();
      
      await testDb.createTenant({
        tenantId,
        tenantName: 'Test Tenant',
        email: 'tenant@test.com'
      });

      await testDb.createClient({
        clientId,
        tenantId,
        clientName: 'Test Client'
      });

      const input = {
        tenantId,
        firstName: 'Jane',
        lastName: 'Manager',
        email: `jane.manager-${timestamp}@testclient.com`,
        clientId
      };

      const result = await createAdminUserInDB(input, testDb);

      expect(result.userId).toBeDefined();

      // Verify user was created
      const user = await testDb.getUserById(result.userId, tenantId);
      expect(user).toBeDefined();

      // Verify user was set as account manager
      const client = await testDb.getClientById(clientId, tenantId);
      expect(client).toBeDefined();
      expect(client.account_manager_id).toBe(result.userId);
    });

    it('should reuse existing Admin role if it exists', async () => {
      // First create a tenant
      const tenantId = uuidv4();
      const timestamp = Date.now();
      await testDb.createTenant({
        tenantId,
        tenantName: 'Test Tenant',
        email: 'tenant@test.com'
      });

      // Create an Admin role first
      const existingRoleId = uuidv4();
      await testDb.createRole({
        roleId: existingRoleId,
        tenantId,
        roleName: 'Admin',
        description: 'Existing admin role'
      });

      const input = {
        tenantId,
        firstName: 'Bob',
        lastName: 'Admin',
        email: `bob.admin-${timestamp}@testclient.com`
      };

      const result = await createAdminUserInDB(input, testDb);

      expect(result.userId).toBeDefined();
      expect(result.roleId).toBe(existingRoleId); // Should reuse existing role

      // Verify only one Admin role exists
      const roles = await testDb.getRolesForTenant(tenantId);
      const adminRoles = roles.filter(r => r.role_name.toLowerCase() === 'admin');
      expect(adminRoles).toHaveLength(1);
    });

    it('should prevent duplicate email addresses', async () => {
      // First create a tenant and user
      const tenantId = uuidv4();
      const timestamp = Date.now();
      await testDb.createTenant({
        tenantId,
        tenantName: 'Test Tenant',
        email: 'tenant@test.com'
      });

      const duplicateEmail = `duplicate-${timestamp}@test.com`;
      const input1 = {
        tenantId,
        firstName: 'First',
        lastName: 'User',
        email: duplicateEmail
      };

      const input2 = {
        tenantId,
        firstName: 'Second',
        lastName: 'User',
        email: duplicateEmail
      };

      // Create first user
      const result1 = await createAdminUserInDB(input1, testDb);
      expect(result1.userId).toBeDefined();

      // Try to create second user with same email - should fail
      await expect(createAdminUserInDB(input2, testDb)).rejects.toThrow(`User with email ${duplicateEmail} already exists`);
    });
  });

  describe('rollbackUserInDB', () => {
    it('should completely remove user and all associated data', async () => {
      // Create tenant, client, and user
      const tenantId = uuidv4();
      const clientId = uuidv4();
      const timestamp = Date.now();
      
      await testDb.createTenant({
        tenantId,
        tenantName: 'Test Tenant',
        email: 'tenant@test.com'
      });

      await testDb.createClient({
        clientId,
        tenantId,
        clientName: 'Test Client'
      });

      const input = {
        tenantId,
        firstName: 'To',
        lastName: 'Delete',
        email: `to.delete-${timestamp}@testclient.com`,
        clientId
      };

      const result = await createAdminUserInDB(input, testDb);
      const userId = result.userId;

      // Verify user exists before deletion
      const userBefore = await testDb.getUserById(userId, tenantId);
      expect(userBefore).toBeDefined();

      // Verify client has account manager set
      const clientBefore = await testDb.getClientById(clientId, tenantId);
      expect(clientBefore.account_manager_id).toBe(userId);

      // Perform rollback
      await rollbackUserInDB(userId, tenantId);

      // Verify user is deleted
      const userAfter = await testDb.getUserById(userId, tenantId);
      expect(userAfter).toBeUndefined();

      // Verify user roles are deleted
      const userRoles = await testDb.getUserRoles(userId, tenantId);
      expect(userRoles).toHaveLength(0);

      // Verify account manager is cleared from client
      const clientAfter = await testDb.getClientById(clientId, tenantId);
      expect(clientAfter.account_manager_id).toBeNull();
    });
  });

  describe('password handling', () => {
    it('should generate secure temporary passwords', async () => {
      const password1 = generateSecurePassword();
      const password2 = generateSecurePassword();
      
      expect(password1).toHaveLength(16);
      expect(password2).toHaveLength(16);
      expect(password1).not.toBe(password2); // Should be random
      
      // Should contain mix of characters
      expect(password1).toMatch(/[A-Z]/);
      expect(password1).toMatch(/[a-z]/);
      expect(password1).toMatch(/[0-9]/);
    });

    it('should hash passwords securely', async () => {
      const password = 'test123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      
      expect(hash1).not.toBe(hash2); // Different salts should produce different hashes
      expect(hash1).toContain(':'); // Should contain salt separator
      expect(hash1.length).toBeGreaterThan(80); // Should be reasonably long
    });
  });
});
