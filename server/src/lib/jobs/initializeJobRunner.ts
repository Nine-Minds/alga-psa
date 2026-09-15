import logger from '@alga-psa/core/logger';
import { registerJobRunnerAccessor } from '@alga-psa/jobs/runner';
import { JobRunnerFactory, getJobRunner } from './JobRunnerFactory';
import { IJobRunner } from './interfaces';
import { StorageService } from '@alga-psa/storage/StorageService';
import { JobService } from '../../services/job.service';
import { registerAllJobHandlers } from './registerAllHandlers';
import { isEnterprise } from '../features';

// Let shared handlers (e.g. workflowScheduledRunHandlers) reach the runner
// without importing the server-bound factory.
registerJobRunnerAccessor(() => getJobRunner());

interface RunnerInitialization {
  promise?: Promise<IJobRunner>;
  registeredHandlers: Set<string>;
}

// Follow the factory's runner lifetime, including replacement after a reset.
const initializations = new WeakMap<IJobRunner, RunnerInitialization>();

/**
 * Initialize the job runner and register all job handlers
 *
 * This function initializes the appropriate job runner (PG Boss for CE,
 * Temporal for EE) and registers all application job handlers.
 *
 * @returns The initialized job runner instance
 */
export async function initializeJobRunner(): Promise<IJobRunner> {
  const runner = await getJobRunner();
  let state = initializations.get(runner);
  if (!state) {
    state = { registeredHandlers: new Set() };
    initializations.set(runner, state);
  }
  // Share both in-flight and successful initialization across all callers.
  // A failed attempt remains retryable, retaining completed registrations.
  const initialization = state;
  initialization.promise ??= initializeRunner(runner, initialization).catch(error => {
    initialization.promise = undefined;
    throw error;
  });
  return initialization.promise;
}

async function initializeRunner(runner: IJobRunner, state: RunnerInitialization): Promise<IJobRunner> {
  logger.info('Initializing job runner...');

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
    if (state.registeredHandlers.has(name)) continue;
    await runner.registerHandler(registered.config);
    state.registeredHandlers.add(name);
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
    initializations.delete(runner);
    logger.info('Job runner stopped');
  }
}
