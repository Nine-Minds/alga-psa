import { Context } from '@temporalio/activity';
import {
  createAdminUserInDB,
  rollbackUserInDB
} from '../db/user-operations';
import type {
  CreateAdminUserActivityInput,
  CreateAdminUserActivityResult
} from '../types/workflow-types';

const logger = () => Context.current().log;

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

  try {
    return await createAdminUserInDB(input);
  } catch (error) {
    log.error('Failed to create admin user', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId: input.tenantId,
      email: input.email 
    });
    throw error;
  }
}

/**
 * Rollback user creation - removes user and associated data
 */
export async function rollbackUser(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back user creation', { userId, tenantId });

  try {
    await rollbackUserInDB(userId, tenantId);
    log.info('User rollback completed', { userId, tenantId });
  } catch (error) {
    log.error('Failed to rollback user', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
      tenantId 
    });
    throw error;
  }
}