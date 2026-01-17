import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';
import { generateSecurePassword } from '@alga-psa/shared/utils/encryption.js';
import { 
  createPortalUserInDB as createPortalUserInSharedModel,
  CreatePortalUserInput
} from '@alga-psa/shared/models/userModel.js';
import type {
  CreatePortalUserActivityInput,
  CreatePortalUserActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Create a portal user in the database
 * This wraps the shared model function and adds temporal-specific logic
 */
export async function createPortalUserInDB(
  input: CreatePortalUserActivityInput
): Promise<CreatePortalUserActivityResult> {
  const log = logger();
  log.info('Creating portal user in database', {
    email: input.email,
    tenantId: input.tenantId,
    contactId: input.contactId,
    clientId: input.clientId
  });

  try {
    const knex = await getAdminConnection();

    // If no password provided, generate a secure temporary password
    const password = input.password || generateSecurePassword();

    // Map to shared model input (ensure email is lowercased)
    const sharedModelInput: CreatePortalUserInput = {
      email: input.email.toLowerCase(),
      password,
      contactId: input.contactId,
      clientId: input.clientId,
      tenantId: input.tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      roleId: input.roleId,
      isClientAdmin: input.isClientAdmin
    };

    // Use the shared model to create the portal user
    const result = await createPortalUserInSharedModel(knex, sharedModelInput);

    if (!result.success) {
      throw new Error(result.error || 'Failed to create portal user');
    }

    log.info('Portal user created successfully', {
      userId: result.userId,
      tenantId: input.tenantId,
      roleId: result.roleId
    });

    return {
      userId: result.userId!,
      roleId: result.roleId!,
      temporaryPassword: input.password ? undefined : password
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to create portal user', { error: errorMessage });
    throw new Error(`Failed to create portal user: ${errorMessage}`);
  }
}

/**
 * Rollback portal user creation (for error handling)
 */
export async function rollbackPortalUserInDB(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back portal user creation', { userId, tenantId });

  try {
    const knex = await getAdminConnection();

    await knex.transaction(async (trx: Knex.Transaction) => {
      // Delete user associations in reverse order
      await trx('user_roles')
        .where({ user_id: userId, tenant: tenantId })
        .delete();

      await trx('users')
        .where({ user_id: userId, tenant: tenantId })
        .delete();
    });

    log.info('Portal user rollback completed', { userId, tenantId });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to rollback portal user', { error: errorMessage, userId, tenantId });
    // Don't throw here - rollback failures shouldn't mask the original error
  }
}