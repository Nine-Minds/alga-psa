import { Context } from '@temporalio/activity';
import {
  createPortalUserInDB as createPortalUserInDBOperation,
  rollbackPortalUserInDB
} from '../db/portal-user-operations.js';
import type {
  CreatePortalUserActivityInput,
  CreatePortalUserActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Creates a portal user for a client company
 */
export async function createPortalUser(
  input: CreatePortalUserActivityInput
): Promise<CreatePortalUserActivityResult> {
  const log = logger();
  log.info('Creating portal user', {
    tenantId: input.tenantId,
    email: input.email,
    contactId: input.contactId,
    companyId: input.companyId
  });

  try {
    return await createPortalUserInDBOperation(input);
  } catch (error) {
    log.error('Failed to create portal user', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId: input.tenantId,
      email: input.email
    });
    throw error;
  }
}

/**
 * Rollback portal user creation - removes user and associated data
 */
export async function rollbackPortalUser(userId: string, tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back portal user creation', { userId, tenantId });

  try {
    await rollbackPortalUserInDB(userId, tenantId);
    log.info('Portal user rollback completed', { userId, tenantId });
  } catch (error) {
    log.error('Failed to rollback portal user', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
      tenantId
    });
    throw error;
  }
}