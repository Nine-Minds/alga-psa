/**
 * Database verification helpers for onboarding integration tests
 * Utilities to verify post-onboarding database state
 */

import type { Knex } from 'knex';
import { expect } from '@playwright/test';

export interface TenantVerificationData {
  tenantId: string;
  tenantName: string;
  email: string;
  clientId?: string;
  adminUserId: string;
}

/**
 * Verify tenant was created correctly in database
 */
export async function verifyTenantCreation(
  db: Knex,
  tenantData: TenantVerificationData
): Promise<void> {
  // Verify tenant exists
  const tenant = await db('tenants')
    .where('tenant', tenantData.tenantId)
    .first();

  expect(tenant).toBeTruthy();
  expect(tenant.client_name).toBe(tenantData.tenantName);
  expect(tenant.email).toBe(tenantData.email);
  expect(tenant.created_at).toBeTruthy();
  expect(tenant.updated_at).toBeTruthy();
}

/**
 * Verify admin user was created correctly
 */
export async function verifyAdminUserCreation(
  db: Knex,
  tenantData: TenantVerificationData,
  expectedUserData: {
    firstName: string;
    lastName: string;
    email: string;
  }
): Promise<void> {
  // Verify user exists
  const user = await db('users')
    .where('user_id', tenantData.adminUserId)
    .where('tenant', tenantData.tenantId)
    .first();

  expect(user).toBeTruthy();
  expect(user.first_name).toBe(expectedUserData.firstName);
  expect(user.last_name).toBe(expectedUserData.lastName);
  expect(user.email).toBe(expectedUserData.email);
  expect(user.user_type).toBe('internal');
  expect(user.hashed_password).toBeTruthy();
  expect(user.created_at).toBeTruthy();

  // Verify user has admin role
  const userRole = await db('user_roles')
    .join('roles', function() {
      this.on('user_roles.role_id', '=', 'roles.role_id')
          .andOn('user_roles.tenant', '=', 'roles.tenant');
    })
    .where('user_roles.user_id', tenantData.adminUserId)
    .where('user_roles.tenant', tenantData.tenantId)
    .where('roles.role_name', 'Admin')
    .first();

  expect(userRole).toBeTruthy();
}

/**
 * Verify client was created correctly (if applicable)
 */
export async function verifyClientCreation(
  db: Knex,
  tenantData: TenantVerificationData,
  expectedClientName: string
): Promise<void> {
  if (!tenantData.clientId) {
    return; // No client expected
  }

  // Verify client exists
  const client = await db('clients')
    .where('client_id', tenantData.clientId)
    .where('tenant', tenantData.tenantId)
    .first();

  expect(client).toBeTruthy();
  expect(client.client_name).toBe(expectedClientName);
  expect(client.created_at).toBeTruthy();

  // Verify tenant-client association
  const tenantClient = await db('tenant_companies')
    .where('tenant', tenantData.tenantId)
    .where('client_id', tenantData.clientId)
    .first();

  expect(tenantClient).toBeTruthy();
  expect(tenantClient.is_default).toBe(true);
}

/**
 * Verify tenant email settings were configured
 */
export async function verifyTenantEmailSettings(
  db: Knex,
  tenantId: string
): Promise<void> {
  const emailSettings = await db('tenant_email_settings')
    .where('tenant_id', tenantId)
    .first();

  expect(emailSettings).toBeTruthy();
  expect(emailSettings.email_provider).toBe('resend');
  expect(emailSettings.fallback_enabled).toBe(true);
  expect(emailSettings.tracking_enabled).toBe(false);
}

/**
 * Verify onboarding completion state
 */
export async function verifyOnboardingCompletionState(
  db: Knex,
  adminUserId: string,
  tenantId: string
): Promise<void> {
  const user = await db('users')
    .where('user_id', adminUserId)
    .where('tenant', tenantId)
    .first();

  expect(user).toBeTruthy();
  
  // Check if onboarding completion is tracked
  if ('onboarding_completed_at' in user) {
    expect(user.onboarding_completed_at).toBeTruthy();
  }
  
  if ('onboarding_state' in user) {
    expect(user.onboarding_state).toBe('completed');
  }
}

/**
 * Verify tenant isolation - ensure no data leakage between tenants
 */
export async function verifyTenantIsolation(
  db: Knex,
  tenantId: string,
  otherTenantIds: string[]
): Promise<void> {
  // Verify users are properly isolated
  const users = await db('users').where('tenant', tenantId);
  expect(users.length).toBeGreaterThan(0);

  for (const userId of users.map(u => u.user_id)) {
    // Verify user roles are only for this tenant
    const userRoles = await db('user_roles')
      .where('user_id', userId)
      .whereNotIn('tenant', [tenantId]);
    
    expect(userRoles.length).toBe(0);
  }

  // Verify clients are properly isolated
  const clients = await db('clients').where('tenant', tenantId);
  for (const clientId of clients.map(c => c.client_id)) {
    // Verify client doesn't appear in other tenants
    const otherTenantClients = await db('clients')
      .where('client_id', clientId)
      .whereNotIn('tenant', [tenantId]);
    
    expect(otherTenantClients.length).toBe(0);
  }
}

/**
 * Verify complete tenant setup
 */
export async function verifyCompleteTenantSetup(
  db: Knex,
  tenantData: TenantVerificationData,
  expectedData: {
    tenantName: string;
    clientName?: string;
    adminUser: {
      firstName: string;
      lastName: string;
      email: string;
    };
  }
): Promise<void> {
  // Verify tenant creation
  await verifyTenantCreation(db, tenantData);

  // Verify admin user creation
  await verifyAdminUserCreation(db, tenantData, expectedData.adminUser);

  // Verify client creation (if applicable)
  if (expectedData.clientName && tenantData.clientId) {
    await verifyClientCreation(db, tenantData, expectedData.clientName);
  }

  // Verify email settings
  await verifyTenantEmailSettings(db, tenantData.tenantId);

  // Verify onboarding completion
  await verifyOnboardingCompletionState(
    db,
    tenantData.adminUserId,
    tenantData.tenantId
  );
}

/**
 * Get tenant statistics for verification
 */
export async function getTenantStats(
  db: Knex,
  tenantId: string
): Promise<{
  userCount: number;
  clientCount: number;
  roleCount: number;
  hasEmailSettings: boolean;
}> {
  const [userCount, clientCount, roleCount, emailSettings] = await Promise.all([
    db('users').where('tenant', tenantId).count('* as count').first(),
    db('clients').where('tenant', tenantId).count('* as count').first(),
    db('roles').where('tenant', tenantId).count('* as count').first(),
    db('tenant_email_settings').where('tenant', tenantId).first(),
  ]);

  return {
    userCount: parseInt(userCount?.count as string) || 0,
    clientCount: parseInt(clientCount?.count as string) || 0,
    roleCount: parseInt(roleCount?.count as string) || 0,
    hasEmailSettings: !!emailSettings,
  };
}

/**
 * Verify tenant data consistency
 */
export async function verifyTenantDataConsistency(
  db: Knex,
  tenantId: string
): Promise<void> {
  // Get all tenant data
  const [tenant, users, clients, roles, userRoles] = await Promise.all([
    db('tenants').where('tenant', tenantId).first(),
    db('users').where('tenant', tenantId),
    db('clients').where('tenant', tenantId),
    db('roles').where('tenant', tenantId),
    db('user_roles').where('tenant', tenantId),
  ]);

  expect(tenant).toBeTruthy();

  // Verify referential integrity
  for (const user of users) {
    expect(user.tenant).toBe(tenantId);
  }

  for (const client of clients) {
    expect(client.tenant).toBe(tenantId);
  }

  for (const role of roles) {
    expect(role.tenant).toBe(tenantId);
  }

  for (const userRole of userRoles) {
    expect(userRole.tenant).toBe(tenantId);
    
    // Verify user exists
    const userExists = users.some(u => u.user_id === userRole.user_id);
    expect(userExists).toBe(true);
    
    // Verify role exists
    const roleExists = roles.some(r => r.role_id === userRole.role_id);
    expect(roleExists).toBe(true);
  }
}

/**
 * Verify tenant settings configuration
 */
export async function verifyTenantSettings(
  db: Knex,
  tenantId: string,
  expectedSettings: {
    onboarding_completed: boolean;
    onboarding_skipped: boolean;
    onboarding_data?: any;
  }
): Promise<void> {
  const tenantSettings = await db('tenant_settings')
    .where('tenant', tenantId)
    .first();

  expect(tenantSettings).toBeTruthy();
  expect(tenantSettings.onboarding_completed).toBe(expectedSettings.onboarding_completed);
  expect(tenantSettings.onboarding_skipped).toBe(expectedSettings.onboarding_skipped);
  
  if (expectedSettings.onboarding_data !== undefined) {
    if (expectedSettings.onboarding_data === null) {
      expect(tenantSettings.onboarding_data).toBeNull();
    } else {
      expect(tenantSettings.onboarding_data).toEqual(expectedSettings.onboarding_data);
    }
  }
  
  expect(tenantSettings.created_at).toBeTruthy();
  expect(tenantSettings.updated_at).toBeTruthy();
}

/**
 * Cleanup verification - ensure tenant data is properly removed
 */
export async function verifyTenantCleanup(
  db: Knex,
  tenantId: string
): Promise<void> {
  const [tenants, users, clients, roles, userRoles, emailSettings, tenantClients, tenantSettings] = await Promise.all([
    db('tenants').where('tenant', tenantId),
    db('users').where('tenant', tenantId),
    db('clients').where('tenant', tenantId),
    db('roles').where('tenant', tenantId),
    db('user_roles').where('tenant', tenantId),
    db('tenant_email_settings').where('tenant', tenantId),
    db('tenant_companies').where('tenant', tenantId),
    db('tenant_settings').where('tenant', tenantId),
  ]);

  // All should be empty after cleanup
  expect(tenants.length).toBe(0);
  expect(users.length).toBe(0);
  expect(clients.length).toBe(0);
  expect(roles.length).toBe(0);
  expect(userRoles.length).toBe(0);
  expect(emailSettings.length).toBe(0);
  expect(tenantClients.length).toBe(0);
  expect(tenantSettings.length).toBe(0);
}
