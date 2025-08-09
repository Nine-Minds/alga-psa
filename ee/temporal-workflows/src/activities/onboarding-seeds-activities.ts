import { Context } from '@temporalio/activity';
import { runOnboardingSeeds } from '../db/onboarding-seeds-operations.js';

const logger = () => Context.current().log;

/**
 * Runs onboarding seeds for a newly created tenant
 * This includes roles, permissions, and role_permissions setup
 */
export async function run_onboarding_seeds(
  tenantId: string
): Promise<{ success: boolean; seedsApplied: string[] }> {
  const log = logger();
  log.info('Running onboarding seeds for tenant', { tenantId });

  try {
    const result = await runOnboardingSeeds(tenantId);
    log.info('Onboarding seeds completed successfully', { 
      tenantId, 
      seedsApplied: result.seedsApplied 
    });
    return result;
  } catch (error) {
    log.error('Failed to run onboarding seeds', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      tenantId 
    });
    throw error;
  }
}