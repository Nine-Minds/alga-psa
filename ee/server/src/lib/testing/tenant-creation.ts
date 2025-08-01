/**
 * Shared tenant creation logic extracted from temporal workflow
 * This module provides the core tenant/user creation functionality outside of workflow context
 */

import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { hashPassword, generateSecurePassword } from '../../../../../server/src/utils/encryption/encryption';

export interface TenantCreationInput {
  tenantName: string;
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;
  };
  companyName?: string;
  billingPlan?: string;
}

export interface TenantCreationResult {
  tenantId: string;
  adminUserId: string;
  companyId?: string;
  temporaryPassword: string;
  success: boolean;
  createdAt: string;
}

export interface CreateTenantResult {
  tenantId: string;
  companyId?: string;
}

export interface CreateAdminUserResult {
  userId: string;
  roleId: string;
  temporaryPassword: string;
}

/**
 * Create a new tenant in the database
 */
export async function createTenant(
  db: Knex,
  input: { tenantName: string; email: string; companyName?: string }
): Promise<CreateTenantResult> {
  return await db.transaction(async (trx) => {
    // Create tenant first
    const tenantResult = await trx('tenants')
      .insert({
        company_name: input.tenantName,
        email: input.email,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('tenant');
    
    const tenantId = tenantResult[0].tenant || tenantResult[0];
    
    // Create company if companyName is provided
    let companyId: string | undefined;
    
    if (input.companyName) {
      const companyResult = await trx('companies')
        .insert({
          company_id: uuidv4(),
          company_name: input.companyName,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('company_id');
      
      companyId = companyResult[0].company_id || companyResult[0];
    }

    return { tenantId, companyId };
  });
}

/**
 * Create an admin user for the tenant
 */
export async function createAdminUser(
  db: Knex,
  input: {
    tenantId: string;
    firstName: string;
    lastName: string;
    email: string;
    companyId?: string;
  }
): Promise<CreateAdminUserResult> {
  return await db.transaction(async (trx) => {
    // Check if user already exists in this tenant
    const existingUser = await trx('users')
      .where({ email: input.email, tenant: input.tenantId })
      .first();

    if (existingUser) {
      throw new Error(`User with email ${input.email} already exists`);
    }

    // Generate temporary password
    const temporaryPassword = generateSecurePassword();
    const hashedPassword = await hashPassword(temporaryPassword);
    
    // Create user
    const userResult = await trx('users')
      .insert({
        user_id: uuidv4(),
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email.toLowerCase(), // Normalize email
        tenant: input.tenantId,
        user_type: 'internal',
        username: input.email.toLowerCase(), // Use normalized email as username
        hashed_password: hashedPassword,
        is_inactive: false, // Critical: explicitly set to false
        two_factor_enabled: false,
        is_google_user: false,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('user_id');
    
    const userId = userResult[0].user_id || userResult[0];

    // Find or create Admin role
    let adminRole = await trx('roles')
      .where({ role_name: 'Admin', tenant: input.tenantId })
      .first();

    let roleId: string;
    if (!adminRole) {
      // Create Admin role for this tenant
      const newRoleResult = await trx('roles')
        .insert({
          role_id: uuidv4(),
          role_name: 'Admin',
          tenant: input.tenantId,
          description: 'Administrator role with full access',
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('role_id');
      
      roleId = newRoleResult[0].role_id || newRoleResult[0];
    } else {
      roleId = adminRole.role_id;
    }

    // Associate user with role
    await trx('user_roles').insert({
      user_id: userId,
      tenant: input.tenantId,
      role_id: roleId,
      created_at: new Date()
    });

    return { userId, roleId, temporaryPassword };
  });
}

/**
 * Setup tenant data (email settings, company associations, etc.)
 */
export async function setupTenantData(
  db: Knex,
  input: {
    tenantId: string;
    adminUserId: string;
    companyId?: string;
    billingPlan?: string;
  }
): Promise<{ setupSteps: string[] }> {
  return await db.transaction(async (trx) => {
    const setupSteps: string[] = [];

    // Set up tenant email settings
    try {
      await trx('tenant_email_settings').insert({
        tenant_id: input.tenantId,
        email_provider: 'resend',
        fallback_enabled: true,
        tracking_enabled: false,
        created_at: new Date(),
        updated_at: new Date()
      });
      setupSteps.push('email_settings');
    } catch (error) {
      // If it already exists, that's fine
      console.log('Tenant email settings already exist, skipping');
    }

    // Create tenant-company association if we have a company
    if (input.companyId) {
      try {
        await trx('tenant_companies').insert({
          tenant: input.tenantId,
          company_id: input.companyId,
          is_default: true,
          created_at: new Date(),
          updated_at: new Date()
        });
        setupSteps.push('tenant_company_association');
      } catch (error) {
        // If it already exists, that's fine
        console.log('Tenant-company association already exists, skipping');
      }
    }

    return { setupSteps };
  });
}

/**
 * Complete tenant creation workflow
 */
export async function createTenantComplete(
  db: Knex,
  input: TenantCreationInput
): Promise<TenantCreationResult> {
  try {
    // Step 1: Create tenant
    const tenantResult = await createTenant(db, {
      tenantName: input.tenantName,
      email: input.adminUser.email,
      companyName: input.companyName,
    });

    // Step 2: Create admin user
    const userResult = await createAdminUser(db, {
      tenantId: tenantResult.tenantId,
      firstName: input.adminUser.firstName,
      lastName: input.adminUser.lastName,
      email: input.adminUser.email,
      companyId: tenantResult.companyId,
    });

    // Step 3: Setup tenant data
    await setupTenantData(db, {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      companyId: tenantResult.companyId,
      billingPlan: input.billingPlan,
    });

    return {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      companyId: tenantResult.companyId,
      temporaryPassword: userResult.temporaryPassword,
      success: true,
      createdAt: new Date().toISOString(),
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to create tenant: ${errorMessage}`);
  }
}

/**
 * Rollback tenant creation
 */
export async function rollbackTenant(db: Knex, tenantId: string): Promise<void> {
  return await db.transaction(async (trx) => {
    // Delete in proper order to avoid foreign key violations
    await trx('user_roles').where('tenant', tenantId).del();
    await trx('users').where('tenant', tenantId).del();
    await trx('roles').where('tenant', tenantId).del();
    await trx('tenant_companies').where('tenant', tenantId).del();
    await trx('tenant_email_settings').where('tenant_id', tenantId).del();
    await trx('companies').where('tenant', tenantId).del();
    await trx('tenants').where('tenant', tenantId).del();
  });
}

// Password generation and hashing are now imported from the shared encryption utility