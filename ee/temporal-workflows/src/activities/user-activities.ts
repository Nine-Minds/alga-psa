import { Context } from '@temporalio/activity';
import { v4 as uuidv4 } from 'uuid';
import { getAdminConnection } from '@shared/db';
import { withAdminTransaction } from '@shared/db';
import { Knex } from 'knex';
import * as crypto from 'crypto';
import { generateTemporaryPassword } from './email-activities';
import type {
  CreateAdminUserActivityInput,
  CreateAdminUserActivityResult
} from '../types/workflow-types';

const logger = () => Context.current().logger;

/**
 * Hash a password using the same method as the main application
 * This should match the implementation in server/src/utils/encryption/encryption.ts
 */
async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.pbkdf2(password, salt, 10000, 64, 'sha512', (err, derivedKey) => {
      if (err) reject(err);
      resolve(salt + ':' + derivedKey.toString('hex'));
    });
  });
}

/**
 * Creates an admin user for the newly created tenant
 */
export async function createAdminUser(
  input: CreateAdminUserActivityInput
): Promise<CreateAdminUserActivityResult> {
  const log = logger();
  log.info('Creating admin user', { 
    tenantId: input.tenantId, 
    email: input.email 
  });

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
    try {
      // Check if user already exists globally
      const existingUser = await trx('users')
        .where({ email: input.email.toLowerCase() })
        .first();

      if (existingUser) {
        throw new Error(`User with email ${input.email} already exists`);
      }

      // Generate user ID and temporary password
      const userId = uuidv4();
      const temporaryPassword = generateTemporaryPassword(12);
      
      log.info('Generated user ID and temporary password', { userId });

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

      log.info('User record created', { userId, email: input.email });

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
        log.info('Created Admin role', { roleId });
      }

      // Assign Admin role to user
      await trx('user_roles').insert({
        user_id: userId,
        role_id: adminRole.role_id,
        tenant: input.tenantId,
        created_at: new Date(),
      });

      log.info('Admin role assigned to user', { 
        userId, 
        roleId: adminRole.role_id 
      });

      // If a company was created, associate the user as the account manager
      if (input.companyId) {
        await trx('companies')
          .where({ 
            company_id: input.companyId,
            tenant: input.tenantId 
          })
          .update({ 
            account_manager_id: userId,
            updated_at: new Date(),
          });

        log.info('User set as account manager for company', { 
          userId, 
          companyId: input.companyId 
        });
      }

      return {
        userId,
        roleId: adminRole.role_id,
        temporaryPassword,
      };

    } catch (error) {
      log.error('Failed to create admin user', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        tenantId: input.tenantId,
        email: input.email 
      });
      throw error;
    }
  });
}

/**
 * Rollback user creation - removes user and associated data
 */
export async function rollbackUser(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back user creation', { userId, tenantId });

  return await withAdminTransaction(async (trx: Knex.Transaction) => {
    try {
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

      // Remove user as account manager from companies
      await trx('companies')
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

      log.info('User rollback completed', { userId, tenantId });

    } catch (error) {
      log.error('Failed to rollback user', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        tenantId 
      });
      throw error;
    }
  });
}