import { Context } from '@temporalio/activity';
import {
  createTenantInDB,
  setupTenantDataInDB,
  rollbackTenantInDB
} from '../db/tenant-operations.js';
import type {
  CreateTenantActivityInput,
  CreateTenantActivityResult,
  SetupTenantDataActivityInput,
  SetupTenantDataActivityResult
} from '../types/workflow-types.js';

const logger = () => Context.current().log;

/**
 * Creates a new tenant in the database
 * This activity handles the core tenant creation process
 */
export async function createTenant(
  input: CreateTenantActivityInput
): Promise<CreateTenantActivityResult> {
  const log = logger();
  log.info('Creating tenant', { tenantName: input.tenantName });

  try {
    return await createTenantInDB(input);
  } catch (error) {
    log.error('Failed to create tenant', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantName: input.tenantName 
    });
    throw error;
  }
}

/**
 * Sets up initial tenant data after tenant and user creation
 * This includes default settings, billing configuration, etc.
 */
export async function setupTenantData(
  input: SetupTenantDataActivityInput
): Promise<SetupTenantDataActivityResult> {
  const log = logger();
  log.info('Setting up tenant data', { tenantId: input.tenantId });

  try {
    return await setupTenantDataInDB(input);
  } catch (error) {
    log.error('Failed to setup tenant data', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId: input.tenantId 
    });
    throw error;
  }
}

/**
 * Rollback tenant creation - removes all tenant-related data
 */
export async function rollbackTenant(tenantId: string): Promise<void> {
  const log = logger();
  log.info('Rolling back tenant creation', { tenantId });

  try {
    await rollbackTenantInDB(tenantId);
    log.info('Tenant rollback completed', { tenantId });
  } catch (error) {
    log.error('Failed to rollback tenant', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId 
    });
    throw error;
  }
}