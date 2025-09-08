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
  companyId?: string;
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
  expect(tenant.company_name).toBe(tenantData.tenantName);
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
    .join('roles', 'user_roles.role_id', 'roles.role_id')
    .where('user_roles.user_id', tenantData.adminUserId)
    .where('user_roles.tenant', tenantData.tenantId)
    .where('roles.role_name', 'Admin')
    .first();

  expect(userRole).toBeTruthy();
}

/**
 * Verify company was created correctly (if applicable)
 */
export async function verifyCompanyCreation(
  db: Knex,
  tenantData: TenantVerificationData,
  expectedCompanyName: string
): Promise<void> {
  if (!tenantData.companyId) {
    return; // No company expected
  }

  // Verify company exists
  const company = await db('companies')
    .where('company_id', tenantData.companyId)
    .where('tenant', tenantData.tenantId)
    .first();

  expect(company).toBeTruthy();
  expect(company.company_name).toBe(expectedCompanyName);
  expect(company.created_at).toBeTruthy();

  // Verify tenant-company association
  const tenantCompany = await db('tenant_companies')
    .where('tenant', tenantData.tenantId)
    .where('company_id', tenantData.companyId)
    .first();

  expect(tenantCompany).toBeTruthy();
  expect(tenantCompany.is_default).toBe(true);
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

  // Verify companies are properly isolated
  const companies = await db('companies').where('tenant', tenantId);
  for (const companyId of companies.map(c => c.company_id)) {
    // Verify company doesn't appear in other tenants
    const otherTenantCompanies = await db('companies')
      .where('company_id', companyId)
      .whereNotIn('tenant', [tenantId]);
    
    expect(otherTenantCompanies.length).toBe(0);
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
    companyName?: string;
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

  // Verify company creation (if applicable)
  if (expectedData.companyName && tenantData.companyId) {
    await verifyCompanyCreation(db, tenantData, expectedData.companyName);
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
  companyCount: number;
  roleCount: number;
  hasEmailSettings: boolean;
}> {
  const [userCount, companyCount, roleCount, emailSettings] = await Promise.all([
    db('users').where('tenant', tenantId).count('* as count').first(),
    db('companies').where('tenant', tenantId).count('* as count').first(),
    db('roles').where('tenant', tenantId).count('* as count').first(),
    db('tenant_email_settings').where('tenant', tenantId).first(),
  ]);

  return {
    userCount: parseInt(userCount?.count as string) || 0,
    companyCount: parseInt(companyCount?.count as string) || 0,
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
  const [tenant, users, companies, roles, userRoles] = await Promise.all([
    db('tenants').where('tenant', tenantId).first(),
    db('users').where('tenant', tenantId),
    db('companies').where('tenant', tenantId),
    db('roles').where('tenant', tenantId),
    db('user_roles').where('tenant', tenantId),
  ]);

  expect(tenant).toBeTruthy();

  // Verify referential integrity
  for (const user of users) {
    expect(user.tenant).toBe(tenantId);
  }

  for (const company of companies) {
    expect(company.tenant).toBe(tenantId);
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
  const [tenants, users, companies, roles, userRoles, emailSettings, tenantCompanies, tenantSettings] = await Promise.all([
    db('tenants').where('tenant', tenantId),
    db('users').where('tenant', tenantId),
    db('companies').where('tenant', tenantId),
    db('roles').where('tenant', tenantId),
    db('user_roles').where('tenant', tenantId),
    db('tenant_email_settings').where('tenant', tenantId),
    db('tenant_companies').where('tenant', tenantId),
    db('tenant_settings').where('tenant', tenantId),
  ]);

  // All should be empty after cleanup
  expect(tenants.length).toBe(0);
  expect(users.length).toBe(0);
  expect(companies.length).toBe(0);
  expect(roles.length).toBe(0);
  expect(userRoles.length).toBe(0);
  expect(emailSettings.length).toBe(0);
  expect(tenantCompanies.length).toBe(0);
  expect(tenantSettings.length).toBe(0);
}