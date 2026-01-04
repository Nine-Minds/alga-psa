import logger from '@shared/core/logger';
import { JobRunnerFactory, getJobRunner } from './JobRunnerFactory';
import { IJobRunner } from './interfaces';
import { StorageService } from '../storage/StorageService';
import { JobService } from '../../services/job.service';
import { registerAllJobHandlers } from './registerAllHandlers';
import { isEnterprise } from '../features';

/**
 * Initialize the job runner and register all job handlers
 *
 * This function initializes the appropriate job runner (PG Boss for CE,
 * Temporal for EE) and registers all application job handlers.
 *
 * @returns The initialized job runner instance
 */
export async function initializeJobRunner(): Promise<IJobRunner> {
  logger.info('Initializing job runner...');

  // Get or create the job runner
  const runner = await getJobRunner();

  // Create services needed by some handlers
  const jobService = await JobService.create();
  const storageService = new StorageService();

  // Register all job handlers using the centralized registry
  // This populates the JobHandlerRegistry which is used by both
  // PgBossJobRunner and Temporal worker activities
  await registerAllJobHandlers({
    jobService,
    storageService,
    includeEnterprise: isEnterprise,
  });

  // Also register handlers directly with the runner for PG Boss compatibility
  // The runner uses its own internal handler map for execution
  const { JobHandlerRegistry } = await import('./jobHandlerRegistry');
  for (const [name, registered] of JobHandlerRegistry.getAll()) {
    runner.registerHandler(registered.config);
  }

  // Start the runner
  await runner.start();

  logger.info(`Job runner initialized successfully`, {
    type: runner.getRunnerType(),
    handlerCount: JobHandlerRegistry.getStats().totalHandlers,
  });

  return runner;
}

/**
 * Get the current job runner instance
 *
 * @returns The job runner instance or null if not initialized
 */
export function getJobRunnerInstance(): IJobRunner | null {
  return JobRunnerFactory.getInstance().getJobRunner();
}

/**
 * Stop the job runner gracefully
 */
export async function stopJobRunner(): Promise<void> {
  const runner = getJobRunnerInstance();
  if (runner) {
    await runner.stop();
    logger.info('Job runner stopped');
  }
}
