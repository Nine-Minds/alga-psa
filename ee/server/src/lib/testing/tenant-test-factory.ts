/**
 * Test data factory for tenant onboarding integration tests
 * Provides utilities for creating test tenants, users, and companies
 */

import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { createTenantComplete, type TenantCreationInput, type TenantCreationResult } from './tenant-creation';

export interface TenantTestData {
  tenant: {
    tenantId: string;
    tenantName: string;
    email: string;
  };
  company?: {
    companyId: string;
    companyName: string;
  };
  adminUser: {
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
    temporaryPassword: string;
  };
}

export interface TenantTestOptions extends Partial<TenantCreationInput> {
  initializeTenantSettings?: boolean;
  onboardingCompleted?: boolean;
  onboardingSkipped?: boolean;
}

/**
 * Create a complete test tenant with admin user for onboarding tests
 */
export async function createTestTenant(
  db: Knex,
  options: TenantTestOptions = {}
): Promise<TenantTestData> {
  const testId = uuidv4().slice(0, 8);
  
  const tenantInput: TenantCreationInput = {
    tenantName: options.tenantName || `Test Tenant ${testId}`,
    adminUser: {
      firstName: options.adminUser?.firstName || 'Test',
      lastName: options.adminUser?.lastName || 'Admin',
      email: options.adminUser?.email || `test-admin-${testId}@example.com`,
    },
    companyName: options.companyName || `Test Company ${testId}`,
    billingPlan: options.billingPlan || 'basic',
  };

  const result = await createTenantComplete(db, tenantInput);

  // Initialize tenant settings if requested
  if (options.initializeTenantSettings) {
    await db('tenant_settings')
      .insert({
        tenant: result.tenantId,
        onboarding_completed: options.onboardingCompleted ?? false,
        onboarding_skipped: options.onboardingSkipped ?? false,
        onboarding_data: null,
        settings: null,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .onConflict('tenant')
      .ignore();
  }

  return {
    tenant: {
      tenantId: result.tenantId,
      tenantName: tenantInput.tenantName,
      email: tenantInput.adminUser.email,
    },
    company: result.companyId ? {
      companyId: result.companyId,
      companyName: tenantInput.companyName!,
    } : undefined,
    adminUser: {
      userId: result.adminUserId,
      firstName: tenantInput.adminUser.firstName,
      lastName: tenantInput.adminUser.lastName,
      email: tenantInput.adminUser.email,
      temporaryPassword: result.temporaryPassword,
    },
  };
}

/**
 * Create multiple test tenants for parallel testing
 */
export async function createTestTenants(
  db: Knex,
  count: number,
  baseOptions: TenantTestOptions = {}
): Promise<TenantTestData[]> {
  const tenants: TenantTestData[] = [];
  
  for (let i = 0; i < count; i++) {
    const testId = uuidv4().slice(0, 8);
    const options: TenantTestOptions = {
      ...baseOptions,
      tenantName: baseOptions.tenantName || `Test Tenant ${i + 1} ${testId}`,
      adminUser: {
        firstName: baseOptions.adminUser?.firstName || 'Test',
        lastName: baseOptions.adminUser?.lastName || 'Admin',
        email: baseOptions.adminUser?.email || `test-admin-${i + 1}-${testId}@example.com`,
      },
      companyName: baseOptions.companyName || `Test Company ${i + 1} ${testId}`,
    };
    
    const tenant = await createTestTenant(db, options);
    tenants.push(tenant);
  }
  
  return tenants;
}

/**
 * Create test tenant with specific onboarding state
 */
export async function createTestTenantWithOnboardingState(
  db: Knex,
  state: 'pending' | 'in_progress' | 'completed' | 'skipped',
  options: TenantTestOptions = {}
): Promise<TenantTestData> {
  // Map states to tenant settings
  const settingsOptions: TenantTestOptions = {
    ...options,
    initializeTenantSettings: true,
    onboardingCompleted: state === 'completed',
    onboardingSkipped: state === 'skipped',
  };
  
  const tenant = await createTestTenant(db, settingsOptions);
  
  return tenant;
}

/**
 * Get test tenant credentials for login
 */
export function getTenantLoginCredentials(tenant: TenantTestData) {
  return {
    email: tenant.adminUser.email,
    password: tenant.adminUser.temporaryPassword,
    tenantId: tenant.tenant.tenantId,
  };
}

/**
 * Create test tenant for specific test scenarios
 */
export const TenantScenarios = {
  /**
   * Basic tenant for happy path testing
   */
  basic: (db: Knex) => createTestTenant(db, {
    tenantName: 'Basic Test Tenant',
    companyName: 'Basic Test Company',
  }),

  /**
   * Tenant without company for edge case testing
   */
  noCompany: (db: Knex) => createTestTenant(db, {
    tenantName: 'No Company Tenant',
    companyName: undefined,
  }),

  /**
   * Tenant with long names for UI testing
   */
  longNames: (db: Knex) => createTestTenant(db, {
    tenantName: 'Very Long Tenant Name That Might Cause UI Issues',
    companyName: 'Very Long Company Name That Might Cause UI Layout Problems',
    adminUser: {
      firstName: 'VeryLongFirstName',
      lastName: 'VeryLongLastNameThatMightCauseIssues',
      email: 'very-long-email-address-for-testing@very-long-domain-name.com',
    },
  }),

  /**
   * Tenant with special characters for validation testing
   */
  specialChars: (db: Knex) => createTestTenant(db, {
    tenantName: "Test & Company, Ltd. (Special Chars!)",
    companyName: "Company with Special Characters: & < > \" '",
    adminUser: {
      firstName: "José",
      lastName: "O'Connor-Smith",
      email: `jose.oconnor+test@example.com`,
    },
  }),
};