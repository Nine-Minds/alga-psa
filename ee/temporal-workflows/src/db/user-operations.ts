import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@shared/db/admin.js';
import type { Knex } from 'knex';
import { hashPassword, generateSecurePassword } from '@shared/utils/encryption.js';
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
      // Check if user already exists in this tenant
      const existingUser = await trx('users')
        .select('user_id')
        .where({ email: input.email, tenant: input.tenantId })
        .first();

      if (existingUser) {
        throw new Error(`User with email ${input.email} already exists`);
      }

      // Generate temporary password
      const temporaryPassword = generateSecurePassword();
      
      // Create user (matching actual Alga schema)
      const userResult = await trx('users')
        .insert({
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          tenant: input.tenantId,
          user_type: 'internal',
          username: input.email, // use email as username
          hashed_password: await hashPassword(temporaryPassword) // hash the temporary password
        })
        .returning('user_id');
      
      const userId = userResult[0].user_id;

      // Find or create Admin role
      let adminRole = await trx('roles')
        .select('role_id')
        .where({ role_name: 'Admin', tenant: input.tenantId })
        .first();

      let roleId: string;
      if (!adminRole) {
        // Create Admin role for this tenant
        const newRoleResult = await trx('roles')
          .insert({
            role_name: 'Admin',
            tenant: input.tenantId,
            description: 'Administrator role with full access'
          })
          .returning('role_id');
        roleId = newRoleResult[0].role_id;
        log.info('Created Admin role', { roleId, tenantId: input.tenantId });
      } else {
        roleId = adminRole.role_id;
      }

      // Associate user with tenant and role (using correct table name)
      await trx('user_roles')
        .insert({
          user_id: userId,
          tenant: input.tenantId,
          role_id: roleId
        });

      // Note: Skipping company association for now - table structure unknown

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
      await trx('user_companies')
        .where({ user_id: userId })
        .delete();
      
      await trx('user_tenant_roles')
        .where({ user_id: userId, tenant_id: tenantId })
        .delete();
      
      await trx('users')
        .where({ user_id: userId })
        .delete();
    });

    log.info('User rollback completed', { userId, tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback user', { error: errorMessage, userId, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}

