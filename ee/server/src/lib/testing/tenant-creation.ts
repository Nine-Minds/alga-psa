/**
 * Shared tenant creation logic extracted from temporal workflow
 * This module provides the core tenant/user creation functionality outside of workflow context
 */

import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { hashPassword, generateSecurePassword } from '@shared/utils/encryption';

async function deleteTenantScopedRows(
  trx: Knex.Transaction,
  table: string,
  tenantId: string
): Promise<void> {
  const hasTenantColumn = await trx.schema.hasColumn(table, 'tenant');
  if (hasTenantColumn) {
    await trx(table).where('tenant', tenantId).del();
    return;
  }

  const hasTenantIdColumn = await trx.schema.hasColumn(table, 'tenant_id');
  if (hasTenantIdColumn) {
    await trx(table).where('tenant_id', tenantId).del();
  }
}

export interface TenantCreationInput {
  tenantName: string;
  adminUser: {
    firstName: string;
    lastName: string;
    email: string;
  };
  companyName?: string;
  clientName?: string;
  contractLine?: string;
}

export interface TenantCreationResult {
  tenantId: string;
  adminUserId: string;
  clientId?: string;
  temporaryPassword: string;
  success: boolean;
  createdAt: string;
}

export interface CreateTenantResult {
  tenantId: string;
  clientId?: string;
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
  input: { tenantName: string; email: string; clientName?: string }
): Promise<CreateTenantResult> {
  return await db.transaction(async (trx) => {
    // Create tenant first
    const tenantCompanyName = input.clientName ?? input.tenantName;
    const tenantResult = await trx('tenants')
      .insert({
        client_name: tenantCompanyName,
        email: input.email,
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('tenant');
    
    const tenantId = tenantResult[0].tenant || tenantResult[0];
    
    // Create client using provided name or fallback to tenant company name
    let clientId: string | undefined;
    if (input.clientName ?? tenantCompanyName) {
      const clientResult = await trx('clients')
        .insert({
          client_id: uuidv4(),
          client_name: input.clientName ?? tenantCompanyName,
          tenant: tenantId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('client_id');
      
      clientId = clientResult[0].client_id || clientResult[0];
    }

    return { tenantId, clientId };
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
    clientId?: string;
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
 * Setup tenant data (email settings, client associations, etc.)
 */
export async function setupTenantData(
  db: Knex,
  input: {
    tenantId: string;
    adminUserId: string;
    clientId?: string;
    contractLine?: string;
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

    // Create tenant-client association if we have a client
    if (input.clientId) {
      try {
        await trx('tenant_companies').insert({
          tenant: input.tenantId,
          client_id: input.clientId,
          is_default: true,
          created_at: new Date(),
          updated_at: new Date()
        });
        setupSteps.push('tenant_client_association');
      } catch (error) {
        // If it already exists, that's fine
        console.log('Tenant-client association already exists, skipping');
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
      clientName: input.clientName,
    });

    // Step 2: Create admin user
    const userResult = await createAdminUser(db, {
      tenantId: tenantResult.tenantId,
      firstName: input.adminUser.firstName,
      lastName: input.adminUser.lastName,
      email: input.adminUser.email,
      clientId: tenantResult.clientId,
    });

    // Step 3: Setup tenant data
    await setupTenantData(db, {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      clientId: tenantResult.clientId,
      contractLine: input.contractLine,
    });

    return {
      tenantId: tenantResult.tenantId,
      adminUserId: userResult.userId,
      clientId: tenantResult.clientId,
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
    // All tables that reference users must be deleted BEFORE users

    // Documents and related tables must be deleted BEFORE external_files (FK constraint)
    await deleteTenantScopedRows(trx, 'document_associations', tenantId);
    await deleteTenantScopedRows(trx, 'document_versions', tenantId);
    await deleteTenantScopedRows(trx, 'document_content', tenantId);
    await deleteTenantScopedRows(trx, 'document_block_content', tenantId);
    await deleteTenantScopedRows(trx, 'documents', tenantId);
    await deleteTenantScopedRows(trx, 'file_store', tenantId);

    // External files reference users (uploaded_by_id) - delete after documents
    await deleteTenantScopedRows(trx, 'external_files', tenantId);

    // Permissions must be deleted before roles
    await deleteTenantScopedRows(trx, 'role_permissions', tenantId);
    await deleteTenantScopedRows(trx, 'permissions', tenantId);

    // Portal and user-related tables
    await deleteTenantScopedRows(trx, 'portal_domain_session_otts', tenantId);
    await deleteTenantScopedRows(trx, 'portal_domains', tenantId);
    await deleteTenantScopedRows(trx, 'user_roles', tenantId);

    // Finally delete users, roles, and tenant
    await deleteTenantScopedRows(trx, 'users', tenantId);
    await deleteTenantScopedRows(trx, 'roles', tenantId);
    await deleteTenantScopedRows(trx, 'tenant_companies', tenantId);
    await deleteTenantScopedRows(trx, 'tenant_email_settings', tenantId);
    await deleteTenantScopedRows(trx, 'clients', tenantId);
    await deleteTenantScopedRows(trx, 'tenants', tenantId);
  });
}

// Password generation and hashing are now imported from the shared encryption utility
