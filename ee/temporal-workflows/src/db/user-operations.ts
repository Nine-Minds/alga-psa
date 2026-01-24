import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';
import { hashPassword, generateSecurePassword } from '@alga-psa/shared/utils/encryption.js';
import type {
  CreateAdminUserActivityInput,
  CreateAdminUserActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Create an admin user for the tenant
 */
export async function createAdminUserInDB(
  input: CreateAdminUserActivityInput
): Promise<CreateAdminUserActivityResult> {
  const log = logger();
  log.info('Creating admin user in database', { 
    email: input.email, 
    tenantId: input.tenantId 
  });

  try {
    const knex = await getAdminConnection();
    
    const result = await knex.transaction(async (trx: Knex.Transaction) => {
      // Check if an internal user with this email already exists in ANY tenant
      // This prevents duplicate MSP users across tenants which causes SSO issues
      const existingInternalUser = await trx('users')
        .select('user_id', 'tenant')
        .where({ email: input.email.toLowerCase(), user_type: 'internal' })
        .first();

      if (existingInternalUser) {
        throw new Error(`An internal user with email ${input.email} already exists. Each internal user email must be unique across all tenants.`);
      }

      // Generate temporary password
      const temporaryPassword = generateSecurePassword();
      
      // Create user (matching actual Alga schema)
      const userResult = await trx('users')
        .insert({
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email.toLowerCase(),
          tenant: input.tenantId,
          user_type: 'internal',
          username: input.email.toLowerCase(), // use lowercased email as username
          hashed_password: await hashPassword(temporaryPassword) // hash the temporary password
        })
        .returning('user_id');
      
      const userId = userResult[0].user_id;

      // Find Admin role (should already exist from onboarding seeds)
      const adminRole = await trx('roles')
        .select('role_id')
        .where({ 
          role_name: 'Admin', 
          tenant: input.tenantId,
          msp: true,  // MSP Admin role, not client portal
          client: false 
        })
        .first();

      if (!adminRole) {
        throw new Error('Admin role not found. Onboarding seeds may not have run properly.');
      }

      const roleId = adminRole.role_id;
      log.info('Using existing Admin role', { roleId, tenantId: input.tenantId });

      // Associate user with tenant and role (using correct table name)
      await trx('user_roles')
        .insert({
          user_id: userId,
          tenant: input.tenantId,
          role_id: roleId
        });

      // Note: Skipping client association for now - table structure unknown

      log.info('Admin user created successfully', { 
        userId, 
        tenantId: input.tenantId, 
        roleId 
      });

      return { userId, roleId, temporaryPassword };
    });

    return {
      userId: result.userId,
      roleId: result.roleId,
      temporaryPassword: result.temporaryPassword,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to create admin user', { error: errorMessage });
    throw new Error(`Failed to create admin user: ${errorMessage}`);
  }
}

/**
 * Rollback user creation (for error handling)
 */
export async function rollbackUserInDB(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back user creation', { userId, tenantId });

  try {
    const knex = await getAdminConnection();

    await knex.transaction(async (trx: Knex.Transaction) => {
      // Delete user associations in reverse order
      // Delete from user_roles first (references users)
      await trx('user_roles')
        .where({ user_id: userId, tenant: tenantId })
        .delete();

      // Delete the user
      await trx('users')
        .where({ user_id: userId, tenant: tenantId })
        .delete();
    });

    log.info('User rollback completed', { userId, tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback user', { error: errorMessage, userId, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}
